import 'dotenv/config'
import { fetchEstatAll } from '../src/fetchers/estat.js'
import { normalizeWages, normalizeNominalWages } from '../src/normalizers/wages.js'
import { upsertWages } from '../src/db/queries.js'
import sql from '../src/db/client.js'

// 実質賃金指数（産業計・製造業、1952〜現在）
const REAL_WAGE_ID = '0003138104'

// 産業別名目賃金指数（現金給与総額）月次: 2001〜2014
const NOMINAL_WAGE_IDS = [
  '0003138246', // 2001〜2003年
  '0003138261', // 2004〜2005年
  '0003138247', // 2006〜2008年
  '0003138262', // 2009〜2010年
  '0003138248', // 2011〜2014年
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
  NOMINAL_WAGE_IDS.map(id => fetchEstatAll(id).then(rows => ({ id, rows })))
)

let totalNominal = 0
for (const { id, rows } of nominalRaws) {
  const records = normalizeNominalWages(rows)
  const count = await upsertWages(records)
  console.log(`  ${id}: fetched ${rows.length}, normalized ${records.length}, upserted ${count}`)
  totalNominal += count
}
console.log(`Total nominal wage rows upserted: ${totalNominal}`)

await sql.end()
console.log(`[${new Date().toISOString()}] Refresh complete.`)
