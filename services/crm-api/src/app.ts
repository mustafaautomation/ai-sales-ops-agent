import { Hono } from 'hono'
import { z } from 'zod'

export type CrmRecord = {
  externalKey: string
  companyName: string
  contactName: string | null
  contactEmail: string | null
  dealTitle: string | null
  stage: string | null
  amountCents: number | null
  quoteNumber: string | null
  domain: string | null
}

const upsertSchema = z.object({
  externalKey: z.string().min(3).max(200),
  companyName: z.string().min(1).max(120),
  contactName: z.string().min(1).max(120),
  contactEmail: z.string().email(),
  dealTitle: z.string().min(1).max(160),
  stage: z.enum(['lead', 'qualified', 'proposal', 'won', 'lost']),
  amountCents: z.number().int().nonnegative(),
  quoteNumber: z.string().max(40).nullable().optional(),
})

export const CRM_FIXTURES: CrmRecord[] = [
  {
    externalKey: 'harbor-glass-cooperative:nightly-office-cleaning',
    companyName: 'Harbor Glass Cooperative',
    contactName: 'Elena Voss',
    contactEmail: 'elena.voss@harbor-glass.example',
    dealTitle: 'Nightly office cleaning',
    stage: 'won',
    amountCents: 1_860_000,
    quoteNumber: 'MF-LEGACY-14',
    domain: 'harbor-glass.example',
  },
  {
    externalKey: 'elm-street-offices:intro-call',
    companyName: 'Elm Street Offices',
    contactName: 'Samir Adeyemi',
    contactEmail: 'samir.adeyemi@elm-street.example',
    dealTitle: 'Intro call',
    stage: 'lead',
    amountCents: 0,
    quoteNumber: null,
    domain: 'elm-street.example',
  },
  {
    externalKey: 'north-yard-storage:floor-care-estimate',
    companyName: 'North Yard Storage',
    contactName: 'June Park',
    contactEmail: 'june.park@north-yard.example',
    dealTitle: 'Floor care estimate',
    stage: 'qualified',
    amountCents: 640_000,
    quoteNumber: null,
    domain: 'north-yard.example',
  },
]

function fault(header: string | undefined, key: string, once: Set<string>): Response | null {
  if (header === '429') {
    return new Response(JSON.stringify({ error: 'rate_limited', message: 'Slow down.' }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '1' },
    })
  }
  if (header === '500') {
    return new Response(JSON.stringify({ error: 'internal' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
  if (header === '500-once') {
    if (!once.has(key)) {
      once.add(key)
      return new Response(JSON.stringify({ error: 'internal' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    }
  }
  return null
}

export function createCrmApp() {
  const records = new Map<string, CrmRecord>(CRM_FIXTURES.map((record) => [record.externalKey, { ...record }]))
  const idem = new Map<string, CrmRecord>()
  const once = new Set<string>()
  const app = new Hono()

  app.get('/health', (c) => c.json({ ok: true, service: 'crm' }))

  app.use('/v1/*', async (c, next) => {
    const key = c.req.header('idempotency-key') ?? c.req.header('x-request-id') ?? 'anon'
    if (c.req.header('x-fault') === 'timeout') await new Promise(() => {})
    const failed = fault(c.req.header('x-fault'), key, once)
    if (failed) return failed
    if (c.req.method === 'POST') {
      const cached = c.req.header('idempotency-key')
      if (cached && idem.has(cached)) return c.json(idem.get(cached)!)
    }
    await next()
  })

  app.get('/v1/records', (c) => {
    const query = (c.req.query('q') ?? '').trim().toLowerCase()
    const list = [...records.values()].filter((record) => {
      if (!query) return true
      return JSON.stringify(record).toLowerCase().includes(query)
    })
    return c.json({ records: list })
  })

  app.post('/v1/upsert', async (c) => {
    const parsed = upsertSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid', message: parsed.error.issues[0]?.message ?? 'Invalid record' }, 400)
    const record: CrmRecord = {
      externalKey: parsed.data.externalKey,
      companyName: parsed.data.companyName,
      contactName: parsed.data.contactName,
      contactEmail: parsed.data.contactEmail,
      dealTitle: parsed.data.dealTitle,
      stage: parsed.data.stage,
      amountCents: parsed.data.amountCents,
      quoteNumber: parsed.data.quoteNumber ?? null,
      domain: parsed.data.contactEmail.split('@')[1] ?? null,
    }
    records.set(record.externalKey, record)
    const key = c.req.header('idempotency-key')
    if (key) idem.set(key, record)
    return c.json(record, 200)
  })

  return app
}
