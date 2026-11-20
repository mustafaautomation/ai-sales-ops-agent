import { Hono } from 'hono'
import { z } from 'zod'

export type EmailRecord = {
  id: string
  direction: 'inbound' | 'outbound'
  from: string
  to: string
  subject: string
  body: string
  clientKey: string | null
  createdAt: string
}

const messageSchema = z.object({
  direction: z.enum(['inbound', 'outbound']),
  from: z.string().min(3).max(200),
  to: z.string().min(3).max(200),
  subject: z.string().min(1).max(180),
  body: z.string().min(1).max(20_000),
  clientKey: z.string().min(1).max(200).nullable().optional(),
})

export const EMAIL_FIXTURES: EmailRecord[] = [
  {
    id: 'e_north',
    direction: 'inbound',
    from: 'Priya Shah <priya.shah@north-wharf.example>',
    to: 'desk@meridian-facilities.example',
    subject: 'Nightly cleaning quote for North Wharf Logistics',
    body: 'Hello,\n\nPlease quote nightly cleaning for 10,000 sqft and 4 restrooms. We want an annual contract.\n\nCompany: North Wharf Logistics',
    clientKey: null,
    createdAt: '2026-04-02T15:04:00.000Z',
  },
  {
    id: 'e_pines',
    direction: 'inbound',
    from: 'Jonah Ellis <jonah.ellis@two-pines.example>',
    to: 'desk@meridian-facilities.example',
    subject: 'Quote for Two Pines School',
    body: 'We are a nonprofit and need nightly cleaning for 8,000 sqft and 6 restrooms.\n\nCompany: Two Pines School',
    clientKey: null,
    createdAt: '2026-04-02T15:11:00.000Z',
  },
  {
    id: 'e_brightline',
    direction: 'inbound',
    from: 'Mara Chen <mara.chen@brightline-cu.example>',
    to: 'desk@meridian-facilities.example',
    subject: 'Green cleaning question',
    body: 'Do you use green cleaning products in an open lobby?\n\nCompany: Brightline Credit Union',
    clientKey: null,
    createdAt: '2026-04-02T15:20:00.000Z',
  },
  {
    id: 'e_west',
    direction: 'inbound',
    from: 'Chris Adelayo <chris.adelayo@west-pier.example>',
    to: 'desk@meridian-facilities.example',
    subject: 'Crew did not show',
    body: 'Our night crew did not show at West Pier Property last Tuesday. Please reschedule this week.\n\nCompany: West Pier Property',
    clientKey: null,
    createdAt: '2026-04-02T16:02:00.000Z',
  },
  {
    id: 'e_halden',
    direction: 'inbound',
    from: 'R. Okada <r.okada@halden-admin.example>',
    to: 'desk@meridian-facilities.example',
    subject: 'Biohazard cleanup',
    body: 'We need biohazard cleanup in a clinical waste room. Can you quote it?\n\nCompany: Halden Clinic Admin',
    clientKey: null,
    createdAt: '2026-04-02T16:18:00.000Z',
  },
  {
    id: 'e_kite',
    direction: 'inbound',
    from: 'Sam <sam@growth-kite.example>',
    to: 'desk@meridian-facilities.example',
    subject: 'Guest post opportunity',
    body: 'We offer SEO services and guest posts for facilities companies. Click here to claim a free audit.',
    clientKey: null,
    createdAt: '2026-04-02T16:40:00.000Z',
  },
  {
    id: 'e_pike',
    direction: 'inbound',
    from: 'Lena Ortiz <lena.ortiz@pike-works.example>',
    to: 'desk@meridian-facilities.example',
    subject: 'Floor and carpet project',
    body: 'Nonprofit community center needs floor refinishing for 5,000 sqft and carpet cleaning for 2,000 sqft.\n\nCompany: Pike Works Community Center',
    clientKey: null,
    createdAt: '2026-04-02T17:05:00.000Z',
  },
  {
    id: 'e_loom',
    direction: 'inbound',
    from: 'Ade Lawal <ade.lawal@loom-office.example>',
    to: 'desk@meridian-facilities.example',
    subject: 'What are your hours?',
    body: 'What are your business hours, and when do night crews usually start?\n\nCompany: Loom Office',
    clientKey: null,
    createdAt: '2026-04-02T17:22:00.000Z',
  },
  {
    id: 'e_crypto',
    direction: 'inbound',
    from: 'airdrop@coins.example',
    to: 'desk@meridian-facilities.example',
    subject: 'You have been selected',
    body: 'Crypto airdrop waiting. Connect your wallet. This is not a cleaning request.',
    clientKey: null,
    createdAt: '2026-04-02T17:31:00.000Z',
  },
  {
    id: 'e_asbestos',
    direction: 'inbound',
    from: 'Pat <pat@oldmill.example>',
    to: 'desk@meridian-facilities.example',
    subject: 'Asbestos tile',
    body: 'Please quote asbestos removal in our warehouse.\n\nCompany: Old Mill Storage',
    clientKey: null,
    createdAt: '2026-04-02T17:44:00.000Z',
  },
  {
    id: 'e_lantern',
    direction: 'inbound',
    from: 'Noor Haddad <noor.haddad@lantern-hall.example>',
    to: 'desk@meridian-facilities.example',
    subject: 'Day porter quote',
    body: 'Could you quote a day porter for 6 hours, three days a week?\n\nCompany: Lantern Hall',
    clientKey: null,
    createdAt: '2026-04-02T18:02:00.000Z',
  },
  {
    id: 'e_silo',
    direction: 'inbound',
    from: 'Billing <billing@silo-and-co.example>',
    to: 'desk@meridian-facilities.example',
    subject: 'Invoice copy',
    body: 'Please send a copy of invoice 4412 and confirm the billing address on the account.\n\nCompany: Silo and Co',
    clientKey: null,
    createdAt: '2026-04-02T18:16:00.000Z',
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

export function createEmailApp() {
  const messages = EMAIL_FIXTURES.map((message) => ({ ...message }))
  const idem = new Map<string, EmailRecord>()
  const once = new Set<string>()
  let sequence = 100
  const app = new Hono()

  app.get('/health', (c) => c.json({ ok: true, service: 'email' }))

  app.use('/v1/*', async (c, next) => {
    const key = c.req.header('idempotency-key') ?? c.req.header('x-request-id') ?? 'anon'
    if (c.req.header('x-fault') === 'timeout') {
      await new Promise(() => {})
    }
    const failed = fault(c.req.header('x-fault'), key, once)
    if (failed) return failed
    if (c.req.method === 'POST') {
      const cached = c.req.header('idempotency-key')
      if (cached && idem.has(cached)) return c.json(idem.get(cached)!, 201)
    }
    await next()
  })

  app.get('/v1/messages', (c) => {
    const direction = c.req.query('direction')
    const filtered = direction ? messages.filter((message) => message.direction === direction) : messages
    return c.json({ messages: filtered })
  })

  app.get('/v1/messages/:id', (c) => {
    const message = messages.find((item) => item.id === c.req.param('id'))
    if (!message) return c.json({ error: 'not_found' }, 404)
    return c.json(message)
  })

  app.post('/v1/messages', async (c) => {
    const parsed = messageSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid', message: parsed.error.issues[0]?.message ?? 'Invalid message' }, 400)
    sequence += 1
    const record: EmailRecord = {
      id: `m_${sequence}`,
      direction: parsed.data.direction,
      from: parsed.data.from,
      to: parsed.data.to,
      subject: parsed.data.subject,
      body: parsed.data.body,
      clientKey: parsed.data.clientKey ?? null,
      createdAt: new Date().toISOString(),
    }
    messages.push(record)
    const key = c.req.header('idempotency-key')
    if (key) idem.set(key, record)
    return c.json(record, 201)
  })

  return app
}
