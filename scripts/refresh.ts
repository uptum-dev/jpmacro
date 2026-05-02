import 'dotenv/config'
import * as XLSX from 'xlsx'
import { fetchEstatAll } from '../src/fetchers/estat.js'
import { normalizeWages, normalizeNominalWages } from '../src/normalizers/wages.js'
import { upsertWages } from '../src/db/queries.js'
import sql from '../src/db/client.js'

// 実質賃金指数（産業計・製造業、1952〜現在）
const REAL_WAGE_ID = '0003138104'

// 産業別名目賃金指数（現金給与総額）月次: 2001〜2014
// base_year: 平成12=2000 / 平成17=2005 / 平成22=2010
const NOMINAL_WAGE_IDS = [
  { id: '0003138246', baseYear: 2000 }, // 2001〜2003年 (平成12年基準)
  { id: '0003138261', baseYear: 2000 }, // 2004〜2005年 (平成12年基準)
  { id: '0003138247', baseYear: 2005 }, // 2006〜2008年 (平成17年基準)
  { id: '0003138262', baseYear: 2005 }, // 2009〜2010年 (平成17年基準)
  { id: '0003138248', baseYear: 2010 }, // 2011〜2014年 (平成22年基準)
]

console.log(`[${new Date().toISOString()}] Starting wage data refresh...`)

// 実質賃金
const realRaw = await fetchEstatAll(REAL_WAGE_ID)
console.log(`Fetched ${realRaw.length} real wage records`)
const realRecords = normalizeWages(realRaw, 'real')
console.log(`Normalized ${realRecords.length} real wage records`)
const realCount = await upsertWages(realRecords)
console.log(`Upserted ${realCount} real wage rows`)

// 産業別名目賃金（5テーブルを並列取得）
console.log('\nFetching nominal wage tables...')
const nominalRaws = await Promise.all(
  NOMINAL_WAGE_IDS.map(({ id, baseYear }) =>
    fetchEstatAll(id).then(rows => ({ id, baseYear, rows }))
  )
)

let totalNominal = 0
for (const { id, baseYear, rows } of nominalRaws) {
  const records = normalizeNominalWages(rows, baseYear)
  const count = await upsertWages(records)
  console.log(`  ${id} (base=${baseYear}): fetched ${rows.length}, normalized ${records.length}, upserted ${count}`)
  totalNominal += count
}
console.log(`Total nominal wage rows upserted: ${totalNominal}`)

// MHLW Excel 実質賃金新系列 (2021〜, 令和2年基準)
console.log('\nFetching MHLW Excel real wage data (new series, base 2020)...')
const MHLW_BASE = 'https://www.mhlw.go.jp/toukei/itiran/roudou/monthly'
const MHLW_FILES = [
  { era: 'r04', yymm: '2201', preliminary: false },
  { era: 'r05', yymm: '2301', preliminary: false },
  { era: 'r06', yymm: '2401', preliminary: false },
  { era: 'r04', yymm: '2212', preliminary: false },
  { era: 'r05', yymm: '2312', preliminary: false },
  { era: 'r06', yymm: '2412', preliminary: false },
  { era: 'r07', yymm: '2501', preliminary: true },
]

function toAscii(s: string) {
  return s.replace(/[０-９]/g, (c: string) => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 0x30))
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

const mhlwMap = new Map<string, { date: string; value: number | null; is_preliminary: boolean }>()
for (const { era, yymm, preliminary } of MHLW_FILES) {
  const sfx = preliminary ? 'p' : 'r'
  const url = `${MHLW_BASE}/${era}/${yymm}${sfx}/xls/${yymm}${sfx}.xlsx`
  const res = await fetch(url, { method: 'HEAD' })
  if (res.status !== 200) { console.log(`  SKIP ${yymm}: 404`); continue }

  const r = await fetch(url)
  const buf = Buffer.from(await r.arrayBuffer())
  const wb = XLSX.read(buf, { type: 'buffer' })
  const ws = wb.Sheets['実質賃金']
  if (!ws) { console.log(`  SKIP ${yymm}: no sheet`); continue }

  const records = parseMhlwSheet(ws, preliminary)
  for (const rec of records) {
    const existing = mhlwMap.get(rec.date)
    if (!existing || (!rec.is_preliminary && existing.is_preliminary)) mhlwMap.set(rec.date, rec)
  }
  console.log(`  ${yymm}${sfx}: ${records.length} rows`)
}

const mhlwRows = [...mhlwMap.values()]
  .filter(r => r.value !== null)
  .map(r => ({ date: r.date, industry_code: 'ALL', wage_type: 'real' as const, value: r.value!, base_year: 2020, is_preliminary: r.is_preliminary, source: 'mhlw-xlsx' }))
  .sort((a, b) => a.date.localeCompare(b.date))
if (mhlwRows.length > 0) {
  await upsertWages(mhlwRows)
  console.log(`MHLW: upserted ${mhlwRows.length} rows (${mhlwRows[0].date} ~ ${mhlwRows.at(-1)!.date})`)
}

await sql.end()
console.log(`[${new Date().toISOString()}] Refresh complete.`)
