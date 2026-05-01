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

/**
 * e-Stat の月次時刻ラベル "2024年1月" → "2024-01-01"
 */
function parseEstatDate(label: string): string | null {
  const m = label.match(/(\d{4})年(\d{1,2})月/)
  if (!m) return null
  const year = m[1]
  const month = m[2].padStart(2, '0')
  return `${year}-${month}-01`
}

/**
 * e-Stat 産業コードを英字コードにマッピング（統計表固有の数値コード → 英字）
 * 実際の e-Stat @cat01 コードは統計ごとに異なるため、
 * ここでは "産業計" を ALL、それ以外はそのまま保持する簡易実装。
 * statsDataId 0003138104 の実運用では @cat01 属性が産業分類を示す。
 */
function mapIndustryCode(raw: string, label?: string): string {
  if (!raw || raw === '0' || (label && label.includes('産業計'))) return 'ALL'
  return raw
}

export function normalizeWages(
  records: EstatValue[],
  wageType: 'real' | 'nominal' = 'real',
  baseYear = 2020,
): WageRecord[] {
  const results: WageRecord[] = []

  for (const rec of records) {
    // 時間軸は "@time" または時間軸ラベル相当のキー
    const timeLabel = rec['@time'] ?? rec['time'] ?? ''
    const date = parseEstatDate(timeLabel)
    if (!date) continue

    // 産業コード
    const industryRaw = rec['@cat01'] ?? rec['cat01'] ?? ''
    const industryLabel = rec['@cat01_label'] ?? ''
    const industry_code = mapIndustryCode(industryRaw, industryLabel)

    // 値文字列: 末尾 "p" は速報値
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
