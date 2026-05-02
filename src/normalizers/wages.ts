import type { EstatValue } from '../fetchers/estat.js'

export interface WageRecord {
  date: string          // 'YYYY-MM-01'
  industry_code: string
  wage_type: 'real' | 'nominal'
  value: number | null
  base_year: number
  is_preliminary: boolean
  source: string
}

function parseValue(raw: string): { value: number | null; is_preliminary: boolean } {
  const trimmed = raw.trim()
  const is_preliminary = trimmed.toLowerCase().endsWith('p')
  const numStr = trimmed.replace(/[^0-9.\-]/g, '')
  const value = numStr === '' || numStr === '-' ? null : parseFloat(numStr)
  return { value, is_preliminary }
}

// --- 実質賃金（statsDataId: 0003138104）---
// @time = "YYYY000000"(調査年), @cat01 = 調査月(101-112=月次), @cat02 = 産業(TL/E)
function parseRealDate(timeCode: string, monthCode: string): string | null {
  const year = timeCode.slice(0, 4)
  if (!/^\d{4}$/.test(year)) return null
  const code = parseInt(monthCode, 10)
  if (code < 101 || code > 112) return null
  return `${year}-${String(code - 100).padStart(2, '0')}-01`
}

export function normalizeWages(
  records: EstatValue[],
  wageType: 'real' | 'nominal' = 'real',
  baseYear = 2010, // 平成22年(2010年)=100
): WageRecord[] {
  const results: WageRecord[] = []
  for (const rec of records) {
    if (rec['@tab'] !== '3003') continue
    if (rec['@cat03'] !== 'T' || rec['@cat04'] !== '00') continue

    const date = parseRealDate(rec['@time'] ?? '', rec['@cat01'] ?? '')
    if (!date) continue

    const industry_code = rec['@cat02'] === 'TL' ? 'ALL' : (rec['@cat02'] ?? '')
    const { value, is_preliminary } = parseValue(rec['$'] ?? '')
    results.push({ date, industry_code, wage_type: wageType, value, base_year: baseYear, is_preliminary, source: 'e-stat' })
  }
  return results
}

// --- 産業別名目賃金指数（statsDataId: 0003138246/61/47/62/48）---
// @time = "YYYYMMMMNN"（年=slice(0,4), 月=slice(8,10)）
// @cat01 = 産業コード(TL/C/D/E/...), @cat03 = 事業所規模(T=5人以上)
function parseNominalDate(timeCode: string): string | null {
  const year = timeCode.slice(0, 4)
  if (!/^\d{4}$/.test(year)) return null
  const month = timeCode.slice(8, 10)
  if (month === '00' || parseInt(month) < 1 || parseInt(month) > 12) return null
  return `${year}-${month}-01`
}

// 前年比・増減率タブ（末尾05/07）を除外する判定
function isIndexTab(tab: string): boolean {
  return !tab.endsWith('05') && !tab.endsWith('07')
}

export function normalizeNominalWages(
  records: EstatValue[],
  baseYear = 2010, // 平成22年(2010年)=100
): WageRecord[] {
  const results: WageRecord[] = []
  for (const rec of records) {
    if (!isIndexTab(rec['@tab'] ?? '')) continue
    if (rec['@cat03'] !== 'T') continue

    const date = parseNominalDate(rec['@time'] ?? '')
    if (!date) continue

    const industry_code = rec['@cat01'] === 'TL' ? 'ALL' : (rec['@cat01'] ?? '')
    const { value, is_preliminary } = parseValue(rec['$'] ?? '')
    results.push({ date, industry_code, wage_type: 'nominal', value, base_year: baseYear, is_preliminary, source: 'e-stat' })
  }
  return results
}
