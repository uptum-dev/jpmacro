import 'dotenv/config'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import sql from '../src/db/client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const schema = readFileSync(join(__dirname, '../src/db/schema.sql'), 'utf8')

console.log('Applying schema...')
await sql.unsafe(schema)
console.log('Migration complete.')
await sql.end()
