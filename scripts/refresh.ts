import 'dotenv/config'
import { fetchEstatAll } from '../src/fetchers/estat.js'
import { normalizeWages } from '../src/normalizers/wages.js'
import { upsertWages } from '../src/db/queries.js'
import sql from '../src/db/client.js'

const REAL_WAGE_STATS_ID = '0003138104'

console.log(`[${new Date().toISOString()}] Starting wage data refresh...`)

const raw = await fetchEstatAll(REAL_WAGE_STATS_ID)
console.log(`Fetched ${raw.length} records from e-Stat`)

const records = normalizeWages(raw, 'real')
console.log(`Normalized ${records.length} wage records`)

const count = await upsertWages(records)
console.log(`Upserted ${count} rows into wage_data`)

await sql.end()
console.log(`[${new Date().toISOString()}] Refresh complete.`)
