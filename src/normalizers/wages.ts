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

// @time = "YYYY000000", @cat01 = "101"-"112"(月次のみ使用)
// 年平均(91)・四半期(92-97)・特殊(120)はスキップ
function parseEstatDate(timeCode: string, monthCode: string): string | null {
  const year = timeCode.slice(0, 4)
  if (!/^\d{4}$/.test(year)) return null

  const code = parseInt(monthCode, 10)
  if (code < 101 || code > 112) return null

  const month = String(code - 100).padStart(2, '0')
  return `${year}-${month}-01`
}

// @cat02: TL=産業計, E=製造業 → シンプルなコードに変換
function mapIndustryCode(cat02: string): string {
  if (!cat02 || cat02 === 'TL') return 'ALL'
  return cat02  // E, etc.
}

export function normalizeWages(
  records: EstatValue[],
  wageType: 'real' | 'nominal' = 'real',
  baseYear = 2010, // 平成22年(2010年)=100
): WageRecord[] {
  const results: WageRecord[] = []

  for (const rec of records) {
    // 指数のみ使用（前年比 tab=3005 はスキップ）
    if (rec['@tab'] !== '3003') continue

    // 5人以上(cat03=T)、就業形態計(cat04=00)のみ
    if (rec['@cat03'] !== 'T' || rec['@cat04'] !== '00') continue

    const date = parseEstatDate(rec['@time'] ?? '', rec['@cat01'] ?? '')
    if (!date) continue

    const industry_code = mapIndustryCode(rec['@cat02'] ?? '')

    const rawValue = (rec['$'] ?? '').trim()
    const is_preliminary = rawValue.toLowerCase().endsWith('p')
    const numStr = rawValue.replace(/[^0-9.\-]/g, '')
    const value = numStr === '' || numStr === '-' ? null : parseFloat(numStr)

    results.push({
      date,
      industry_code,
      wage_type: wageType,
      value,
      base_year: baseYear,
      is_preliminary,
      source: 'e-stat',
    })
  }

  return results
}
