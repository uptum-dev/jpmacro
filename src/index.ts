import 'dotenv/config'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import wagesRoutes from './routes/wages.js'

const app = new Hono()

app.use('*', async (c, next) => {
  await next()
  if (!c.res.headers.get('Content-Type')?.includes('charset')) {
    c.res.headers.set('Content-Type', 'application/json; charset=utf-8')
  }
})

app.get('/', (c) =>
  c.json({
    name: 'jpmacro',
    version: '1.0.0',
    endpoints: [
      'GET /v1/wages/latest      — latest real wage index ($0.03/call)',
      'GET /v1/wages/real        — real wage index time-series, 1952-present, ALL+Manufacturing ($0.02/call)',
      'GET /v1/wages/nominal     — nominal wage index by industry, 2001-2014, 84 industries ($0.02/call)',
      'GET /v1/wages/industries  — industry code reference (free)',
    ],
  }),
)

app.route('/v1/wages', wagesRoutes)

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

const port = Number(process.env.PORT ?? 3000)
console.log(`jpmacro listening on port ${port}`)

serve({ fetch: app.fetch, port })
