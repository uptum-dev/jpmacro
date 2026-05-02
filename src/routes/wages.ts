import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { getLatestWage, getRealWages, getIndustries } from '../db/queries.js'
import { paywall } from '../middleware/x402.js'

const app = new Hono()

const nowYM = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function defaultFrom(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 24)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const ymSchema = z.string().regex(/^\d{4}-\d{2}$/, 'Must be YYYY-MM')

// GET /v1/wages/latest  — 3¢/call
app.use('/latest', paywall('Latest Japan real wage index (preliminary)', 0.03))
app.get('/latest', async (c) => {
  const row = await getLatestWage()
  if (!row) return c.json({ error: 'No data available' }, 404)

  return c.json({
    data: {
      date: row.date,
      wage_type: row.wage_type,
      value: row.value,
      base_year: row.base_year,
    },
    meta: {
      source: row.source,
      retrieved_at: row.retrieved_at,
      base_year: row.base_year,
      is_preliminary: row.is_preliminary,
    },
  })
})

// GET /v1/wages/real  — 2¢/call
const realQuerySchema = z.object({
  from: ymSchema.optional(),
  to: ymSchema.optional(),
  industry: z.string().optional(),
})

app.use('/real', paywall('Japan real wage index time-series', 0.02))
app.get('/real', zValidator('query', realQuerySchema), async (c) => {
  const { from = defaultFrom(), to = nowYM(), industry } = c.req.valid('query')

  const rows = await getRealWages(from, to, industry)
  const latestRetrievedAt = rows.at(-1)?.retrieved_at ?? null

  return c.json({
    data: rows.map((r) => ({
      date: r.date,
      industry_code: r.industry_code,
      value: r.value,
      is_preliminary: r.is_preliminary,
    })),
    meta: {
      source: 'e-stat',
      retrieved_at: latestRetrievedAt,
      base_year: 2010,
      from,
      to,
      industry_code: industry ?? 'ALL',
      count: rows.length,
    },
  })
})

// GET /v1/wages/industries  — free
app.get('/industries', async (c) => {
  const rows = await getIndustries()
  return c.json({
    data: rows,
    meta: {
      source: 'e-stat',
      count: rows.length,
    },
  })
})

export default app
