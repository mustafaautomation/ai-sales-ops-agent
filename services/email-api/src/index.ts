import { serve } from '@hono/node-server'
import { createEmailApp } from './app'

const port = Number(process.env.PORT ?? 4001)
serve({ fetch: createEmailApp().fetch, port }, (info) => {
  console.log(`email-api listening on ${info.port}`)
})
