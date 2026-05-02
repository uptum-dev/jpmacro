/**
 * MHLW 毎月勤労統計 実質賃金指数 インポート
 * 対象: 2021-01 〜 最新 (令和2年基準=100)
 * Usage: npx tsx scripts/import_mhlw.ts
 */
import 'dotenv/config'
import * as XLSX from 'xlsx'
import { upsertWages } from '../src/db/queries.js'
import sql from '../src/db/client.js'

const BASE_URL = 'https://www.mhlw.go.jp/toukei/itiran/roudou/monthly'
const BASE_YEAR = 2020  // 令和2年平均=100

// Era prefix mapping
function eraPrefix(year: number): string {
  if (year >= 2025) return 'r07'
  if (year >= 2024) return 'r06'
  if (year >= 2023) return 'r05'
  if (year >= 2022) return 'r04'
  if (year >= 2021) return 'r03'
  if (year >= 2020) return 'r02'
  return 'r01'
}

// Build URL for a given year/month
function buildUrl(year: number, month: number, preliminary: boolean): string {
  const era = eraPrefix(year)
  const yy = String(year).slice(2)
  const mm = String(month).padStart(2, '0')
  const suffix = preliminary ? 'p' : 'r'
  return `${BASE_URL}/${era}/${yy}${mm}${suffix}/xls/${yy}${mm}${suffix}.xlsx`
}

// 全角数字を半角に変換
function toAscii(s: string): string {
  return s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 0x30))
}

interface ParsedDate { year: number; month: number }

function parseJapaneseDate(text: string, prevDate: ParsedDate | null): ParsedDate | null {
  const t = toAscii(text.trim())

  // 令和元年M月
  const m1 = t.match(/令和元年(\d+)月/)
  if (m1) return { year: 2019, month: parseInt(m1[1]) }

  // 令和N年M月
  const m2 = t.match(/令和(\d+)年(\d+)月/)
  if (m2) return { year: 2018 + parseInt(m2[1]), month: parseInt(m2[2]) }

  // N年M月 (令和継続)
  const m3 = t.match(/^(\d+)年(\d+)月/)
  if (m3) return { year: 2018 + parseInt(m3[1]), month: parseInt(m3[2]) }

  // M月のみ (年継続)
  const m4 = t.match(/^(\d+)月$/)
  if (m4 && prevDate) {
    const month = parseInt(m4[1])
    const year = month <= prevDate.month ? prevDate.year + 1 : prevDate.year
    return { year, month }
  }

  return null
}

function isMonthRow(row: any[]): boolean {
  const first = row[0]
  if (typeof first !== 'string') return false
  const t = toAscii(first.trim())
  return t.includes('月') && !t.startsWith('注') && t !== '年　月'
}

function parseSheet(ws: XLSX.WorkSheet, isPreliminary: boolean): Array<{ date: string; value: number | null; is_preliminary: boolean }> {
  const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' })
  const results: Array<{ date: string; value: number | null; is_preliminary: boolean }> = []
  let prevDate: ParsedDate | null = null

  for (const row of data) {
    if (!isMonthRow(row)) continue

    const parsed = parseJapaneseDate(row[0] as string, prevDate)
    if (!parsed) continue
    prevDate = parsed

    const raw = row[2]
    const value = typeof raw === 'number' ? raw
      : (typeof raw === 'string' && raw.trim() !== '' ? parseFloat(raw.trim()) : null)

    const { year, month } = parsed
    results.push({
      date: `${year}-${String(month).padStart(2, '0')}-01`,
      value: (value === null || isNaN(value as number)) ? null : value,
      is_preliminary: isPreliminary,
    })
  }

  return results
}

// Records map: date → best available record (revised > preliminary)
const allRecords = new Map<string, { date: string; value: number | null; is_preliminary: boolean }>()

function upsertRecord(r: { date: string; value: number | null; is_preliminary: boolean }) {
  const existing = allRecords.get(r.date)
  // Take revised over preliminary, or if same type, take the newer (later file wins)
  if (!existing || (!r.is_preliminary && existing.is_preliminary)) {
    allRecords.set(r.date, r)
  }
}

async function fetchAndParse(year: number, month: number, preliminary: boolean): Promise<number> {
  const url = buildUrl(year, month, preliminary)
  const res = await fetch(url, { method: 'HEAD' })
  if (res.status !== 200) return 0

  const r = await fetch(url)
  const buf = Buffer.from(await r.arrayBuffer())
  const wb = XLSX.read(buf, { type: 'buffer' })
  const ws = wb.Sheets['実質賃金']
  if (!ws) return 0

  const records = parseSheet(ws, preliminary)
  for (const rec of records) upsertRecord(rec)
  return records.length
}

console.log('Importing MHLW 実質賃金 data (2021-present, base year 2020)...\n')

// Download revised files for 2021-2024 (one per year starting from Jan to get all prev-year months)
// Also download December revised files to fill in recent months
const downloads: Array<{ year: number; month: number; preliminary: boolean }> = [
  // January revised files — each covers prev Dec + all 12 months of current year
  { year: 2022, month: 1, preliminary: false },
  { year: 2023, month: 1, preliminary: false },
  { year: 2024, month: 1, preliminary: false },
  // December revised files — capture full year data
  { year: 2022, month: 12, preliminary: false },
  { year: 2023, month: 12, preliminary: false },
  { year: 2024, month: 12, preliminary: false },
  // Latest preliminary
  { year: 2025, month: 1, preliminary: true },
]

for (const { year, month, preliminary } of downloads) {
  const yy = String(year).slice(2)
  const mm = String(month).padStart(2, '0')
  const type = preliminary ? 'prelim' : 'revised'
  process.stdout.write(`  ${year}-${mm} ${type}... `)
  const count = await fetchAndParse(year, month, preliminary)
  console.log(count > 0 ? `${count} rows parsed` : 'SKIP (404)')
}

// Build final DB rows
const dbRows = [...allRecords.values()]
  .filter(r => r.value !== null)
  .map(r => ({
    date: r.date,
    industry_code: 'ALL',
    wage_type: 'real' as const,
    value: r.value!,
    base_year: BASE_YEAR,
    is_preliminary: r.is_preliminary,
    source: 'mhlw-xlsx',
  }))
  .sort((a, b) => a.date.localeCompare(b.date))

console.log(`\nUnique months: ${dbRows.length}`)
if (dbRows.length > 0) {
  console.log(`Range: ${dbRows[0].date} → ${dbRows.at(-1)!.date}`)
  await upsertWages(dbRows)
  console.log(`Upserted ${dbRows.length} rows into wage_data`)
}

await sql.end()
console.log('Done.')
