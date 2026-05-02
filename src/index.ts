import 'dotenv/config'
import { serve } from '@hono/node-server'
import app from './app.js'

const port = Number(process.env.PORT ?? 3000)
console.log(`jpmacro listening on port ${port}`)
serve({ fetch: app.fetch, port })
