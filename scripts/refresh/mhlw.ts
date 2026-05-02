/**
 * MHLW月次実質賃金更新スクリプト
 * 毎月労働省が公開するExcelファイルから実質賃金指数（令和2年=100）を取得しDBに反映する。
 * ファイルリストはハードコードせず、2022-01から当月-2ヶ月まで自動的に試行する。
 */
import 'dotenv/config'
import * as XLSX from 'xlsx'
import { upsertWages } from '../../src/db/queries.js'
import sql from '../../src/db/client.js'

const MHLW_BASE = 'https://www.mhlw.go.jp/toukei/itiran/roudou/monthly'

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

function parseMhlwSheet(ws: XLSX.WorkSheet, isPrelim: boolean) {
  const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' })
  const results: Array<{ date: string; value: number | null; is_preliminary: boolean }> = []
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

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

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
  const ws = wb.Sheets['実質賃金']
  if (!ws) { console.log(`  SKIP ${yymm}${sfx}: シートなし`); return null }

  return { records: parseMhlwSheet(ws, preliminary), yymm, sfx }
}

// 2022-01 から 当月-2ヶ月 まで自動試行
const now = new Date()
const endYear = now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear()
const endMonth = ((now.getMonth() - 1 + 12) % 12) + 1  // 2ヶ月前

const mhlwMap = new Map<string, { date: string; value: number | null; is_preliminary: boolean }>()

for (let y = 2022; y <= endYear; y++) {
  const mStart = y === 2022 ? 1 : 1
  const mEnd = y === endYear ? endMonth : 12
  for (let m = mStart; m <= mEnd; m++) {
    // 確報を優先、なければ速報を試す
    const result = await tryFetch(y, m, false) ?? await tryFetch(y, m, true)
    if (!result) continue
    for (const rec of result.records) {
      const existing = mhlwMap.get(rec.date)
      if (!existing || (!rec.is_preliminary && existing.is_preliminary)) {
        mhlwMap.set(rec.date, rec)
      }
    }
    console.log(`  ${result.yymm}${result.sfx}: ${result.records.length}行`)
  }
}

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
