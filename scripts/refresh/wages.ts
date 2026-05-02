/**
 * e-Stat賃金データ更新スクリプト（実質・名目）
 * 歴史的データのため基本は初回のみ実行、訂正があれば再実行する。
 */
import 'dotenv/config'
import { fetchEstatAll } from '../../src/fetchers/estat.js'
import { normalizeWages, normalizeNominalWages } from '../../src/normalizers/wages.js'
import { upsertWages } from '../../src/db/queries.js'
import sql from '../../src/db/client.js'

const REAL_WAGE_ID = '0003138104'

const NOMINAL_WAGE_IDS = [
  { id: '0003138246', baseYear: 2000 },
  { id: '0003138261', baseYear: 2000 },
  { id: '0003138247', baseYear: 2005 },
  { id: '0003138262', baseYear: 2005 },
  { id: '0003138248', baseYear: 2010 },
]

console.log('e-Stat 実質賃金を取得中...')
const realRaw = await fetchEstatAll(REAL_WAGE_ID)
const realRecords = normalizeWages(realRaw, 'real')
const realCount = await upsertWages(realRecords)
console.log(`  実質賃金: ${realCount}行 upsert完了`)

console.log('e-Stat 名目賃金を取得中...')
const nominalRaws = await Promise.all(
  NOMINAL_WAGE_IDS.map(({ id, baseYear }) =>
    fetchEstatAll(id).then(rows => ({ id, baseYear, rows }))
  )
)
let total = 0
for (const { id, baseYear, rows } of nominalRaws) {
  const records = normalizeNominalWages(rows, baseYear)
  const count = await upsertWages(records)
  console.log(`  ${id} (base=${baseYear}): ${count}行`)
  total += count
}
console.log(`  名目賃金合計: ${total}行 upsert完了`)

await sql.end()
