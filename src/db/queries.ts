import sql from './client.js'

export interface WageRow {
  date: string          // 'YYYY-MM'
  industry_code: string
  wage_type: string
  value: number
  base_year: number
  is_preliminary: boolean
  source: string
  retrieved_at: string
}

export interface IndustryRow {
  code: string
  name_en: string
  name_ja: string
}

export async function getLatestWage(): Promise<WageRow | null> {
  const rows = await sql<WageRow[]>`
    SELECT
      TO_CHAR(date, 'YYYY-MM') AS date,
      industry_code, wage_type, value::float AS value,
      base_year, is_preliminary, source,
      retrieved_at::text AS retrieved_at
    FROM wage_data
    WHERE industry_code = 'ALL' AND wage_type = 'real'
    ORDER BY date DESC
    LIMIT 1
  `
  return rows[0] ?? null
}

export async function getRealWages(
  from: string,
  to: string,
  industry?: string,
): Promise<WageRow[]> {
  const code = industry ?? 'ALL'
  return sql<WageRow[]>`
    SELECT
      TO_CHAR(date, 'YYYY-MM') AS date,
      industry_code, wage_type, value::float AS value,
      base_year, is_preliminary, source,
      retrieved_at::text AS retrieved_at
    FROM wage_data
    WHERE
      wage_type = 'real'
      AND industry_code = ${code}
      AND date >= ${from + '-01'}
      AND date <= ${to + '-01'}
    ORDER BY date ASC
  `
}

export async function getIndustries(): Promise<IndustryRow[]> {
  return sql<IndustryRow[]>`SELECT code, name_en, name_ja FROM industries ORDER BY code`
}

export async function upsertWages(rows: {
  date: string
  industry_code: string
  wage_type: string
  value: number | null
  base_year: number
  is_preliminary: boolean
  source: string
}[]): Promise<number> {
  if (rows.length === 0) return 0
  await sql`
    INSERT INTO wage_data ${sql(rows, 'date', 'industry_code', 'wage_type', 'value', 'base_year', 'is_preliminary', 'source')}
    ON CONFLICT (date, industry_code, wage_type)
    DO UPDATE SET
      value          = EXCLUDED.value,
      is_preliminary = EXCLUDED.is_preliminary,
      retrieved_at   = NOW()
  `
  return rows.length
}
