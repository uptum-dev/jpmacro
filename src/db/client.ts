import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

const sql = postgres(url, {
  max: process.env.VERCEL ? 1 : 10,
  ssl: url.includes('neon.tech') ? 'require' : false,
  connect_timeout: 10,
  idle_timeout: 20,
})

export default sql
