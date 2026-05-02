/**
 * MHLW月次実質賃金更新スクリプト
 * 2022-01から当月-2ヶ月まで自動検出し取得する。
 *
 * フォーマット変更対応:
 *   〜2025-02: '実質賃金' シートに実質賃金指数（水準）あり → 直接取得
 *   2025-03〜: '実質賃金' シートが廃止 → '賃金指数' シートの実質前年比から前年同月比チェーンで算出
 */
import 'dotenv/config'
import * as XLSX from 'xlsx'
import { upsertWages } from '../../src/db/queries.js'
import sql from '../../src/db/client.js'

const MHLW_BASE = 'https://www.mhlw.go.jp/toukei/itiran/roudou/monthly'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function toAscii(s: string) {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 0x30))
}

function buildUrl(year: number, month: number, preliminary: boolean) {
  const reiwa = year - 2018
  const era = `r${String(reiwa).padStart(2, '0')}`
  const yymm = `${String(year % 100).padStart(2, '0')}${String(month).padStart(2, '0')}`
  const sfx = preliminary ? 'p' : 'r'
  return { url: `${MHLW_BASE}/${era}/${yymm}${sfx}/xls/${yymm}${sfx}.xlsx`, yymm, sfx }
}

type Row = { date: string; value: number | null; is_preliminary: boolean }

/** 旧フォーマット: '実質賃金' シートから直接取得 */
function parseOldSheet(ws: XLSX.WorkSheet, isPrelim: boolean): Row[] {
  const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' })
  const results: Row[] = []
  let prevDate: { year: number; month: number } | null = null

  for (const row of data) {
    const first = row[0]
    if (typeof first !== 'string') continue
    const t = toAscii(first.trim())
    if (!t.includes('月') || t.startsWith('注') || t === '年　月') continue

    let year = 0, month = 0
    const m1 = t.match(/令和元年(\d+)月/)
    const m2 = t.match(/令和(\d+)年(\d+)月/)
    const m3 = t.match(/^(\d+)年(\d+)月/)
    const m4 = t.match(/^(\d+)月$/)

    if (m1) { year = 2019; month = parseInt(m1[1]) }
    else if (m2) { year = 2018 + parseInt(m2[1]); month = parseInt(m2[2]) }
    else if (m3) { year = 2018 + parseInt(m3[1]); month = parseInt(m3[2]) }
    else if (m4 && prevDate) {
      month = parseInt(m4[1])
      year = month <= prevDate.month ? prevDate.year + 1 : prevDate.year
    } else continue

    prevDate = { year, month }
    const raw = row[2]
    const value = typeof raw === 'number' ? raw : (typeof raw === 'string' && raw.trim() ? parseFloat(raw) : null)
    results.push({
      date: `${year}-${String(month).padStart(2, '0')}-01`,
      value: value === null || isNaN(value as number) ? null : value,
      is_preliminary: isPrelim,
    })
  }
  return results
}

/** 新フォーマット: '賃金指数' シートの実質前年比から { date → realYoy } を抽出 */
function parseNewSheetYoy(ws: XLSX.WorkSheet): Map<string, number> {
  const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' })
  const yoyMap = new Map<string, number>()
  let prevDate: { year: number; month: number } | null = null
  let inCashSection = false

  for (const row of data) {
    const first = row[0]
    if (typeof first !== 'string') continue
    const t = toAscii(first.trim())

    // 「現金給与総額」セクション開始
    if (t.includes('現　金　給　与　総　額') || t.includes('現金給与総額')) {
      inCashSection = true; prevDate = null; continue
    }
    // 「きまって支給する給与」セクションで終了
    if (t.includes('きまって支給') || t.includes('所　定　内')) {
      inCashSection = false; continue
    }
    if (!inCashSection) continue
    if (!t.includes('月')) continue

    let year = 0, month = 0
    const m2 = t.match(/令和(\d+)年(\d+)月/)
    const m3 = t.match(/^(\d+)年(\d+)月/)
    const m4 = t.match(/^(\d+)月$/)

    if (m2) { year = 2018 + parseInt(m2[1]); month = parseInt(m2[2]) }
    else if (m3) { year = 2018 + parseInt(m3[1]); month = parseInt(m3[2]) }
    else if (m4 && prevDate) {
      month = parseInt(m4[1])
      year = month <= prevDate.month ? prevDate.year + 1 : prevDate.year
    } else continue

    prevDate = { year, month }
    // col 4 = 実質前年比（%）
    const raw = row[4]
    const yoy = typeof raw === 'number' ? raw : (typeof raw === 'string' && raw.trim() ? parseFloat(raw) : null)
    if (yoy !== null && !isNaN(yoy)) {
      yoyMap.set(`${year}-${String(month).padStart(2, '0')}-01`, yoy)
    }
  }
  return yoyMap
}

async function tryFetch(year: number, month: number, preliminary: boolean) {
  const { url, yymm, sfx } = buildUrl(year, month, preliminary)
  const head = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA } }).catch(() => null)
  if (!head || head.status !== 200) {
    if (head) console.log(`  SKIP ${yymm}${sfx}: HTTP ${head.status}`)
    return null
  }

  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  const buf = Buffer.from(await res.arrayBuffer())
  const wb = XLSX.read(buf, { type: 'buffer' })

  // 旧フォーマット
  if (wb.Sheets['実質賃金']) {
    return { rows: parseOldSheet(wb.Sheets['実質賃金'], preliminary), yymm, sfx, format: 'old' as const }
  }
  // 新フォーマット（実質前年比のみ）
  if (wb.Sheets['賃金指数']) {
    const yoyMap = parseNewSheetYoy(wb.Sheets['賃金指数'])
    return { rows: null, yoyMap, yymm, sfx, format: 'new' as const }
  }
  console.log(`  SKIP ${yymm}${sfx}: シートなし`)
  return null
}

// 2022-01 から 当月-2ヶ月 まで
const now = new Date()
const endYear = now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear()
const endMonth = ((now.getMonth() - 1 + 12) % 12) + 1

// 実績値マップ（チェーン計算に使用）
const mhlwMap = new Map<string, Row>()
// 新フォーマットの前年比データ（後処理用）
const pendingYoy = new Map<string, { yoy: number; isPrelim: boolean }>()

for (let y = 2022; y <= endYear; y++) {
  const mEnd = y === endYear ? endMonth : 12
  for (let m = 1; m <= mEnd; m++) {
    const result = await tryFetch(y, m, false) ?? await tryFetch(y, m, true)
    if (!result) continue

    if (result.format === 'old' && result.rows) {
      for (const rec of result.rows) {
        const existing = mhlwMap.get(rec.date)
        if (!existing || (!rec.is_preliminary && existing.is_preliminary)) {
          mhlwMap.set(rec.date, rec)
        }
      }
      console.log(`  ${result.yymm}${result.sfx}: ${result.rows.length}行（旧フォーマット）`)
    } else if (result.format === 'new' && result.yoyMap) {
      for (const [date, yoy] of result.yoyMap) {
        if (!mhlwMap.has(date)) {
          pendingYoy.set(date, { yoy, isPrelim: result.sfx === 'p' })
        }
      }
      console.log(`  ${result.yymm}${result.sfx}: ${result.yoyMap.size}件の前年比（新フォーマット）`)
    }
  }
}

// 新フォーマット分をチェーンで計算
let chainCount = 0
for (const [date, { yoy, isPrelim }] of pendingYoy) {
  const [y, m] = date.split('-').map(Number)
  const prevYear = `${y - 1}-${String(m).padStart(2, '0')}-01`
  const prevValue = mhlwMap.get(prevYear)?.value
  if (prevValue == null) continue
  const value = Math.round(prevValue * (1 + yoy / 100) * 100) / 100
  const existing = mhlwMap.get(date)
  if (!existing || (!isPrelim && existing.is_preliminary)) {
    mhlwMap.set(date, { date, value, is_preliminary: isPrelim })
    chainCount++
  }
}
if (chainCount > 0) console.log(`  チェーン計算: ${chainCount}件`)

const rows = [...mhlwMap.values()]
  .filter(r => r.value !== null)
  .map(r => ({
    date: r.date,
    industry_code: 'ALL',
    wage_type: 'real' as const,
    value: r.value!,
    base_year: 2020,
    is_preliminary: r.is_preliminary,
    source: 'mhlw-xlsx',
  }))
  .sort((a, b) => a.date.localeCompare(b.date))

if (rows.length > 0) {
  await upsertWages(rows)
  console.log(`MHLW: ${rows.length}行 upsert完了 (${rows[0].date} 〜 ${rows.at(-1)!.date})`)
} else {
  console.log('MHLW: 新規データなし')
}

await sql.end()
