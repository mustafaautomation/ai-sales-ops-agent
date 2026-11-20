import { serve } from '@hono/node-server'
import { createCrmApp } from './app'

const port = Number(process.env.PORT ?? 4002)
serve({ fetch: createCrmApp().fetch, port }, (info) => {
  console.log(`crm-api listening on ${info.port}`)
})
