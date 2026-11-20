import { hashVisitor, utcDay, CALLS_PER_DAY, CALLS_PER_IP, CALL_WINDOW_MS, FORM_PER_DAY, LLM_PER_DAY, LLM_PER_IP_DAY } from '../../packages/core/src/limits'
import { signVapiPublicJwt } from '../../packages/core/src/vapi-jwt'
import { migrateD1 } from './d1'
import { createInquiry, listRows, seedReference, stepInquiry, type WorkerEnv } from './desk'
import { takeDaily, takeWindow } from './limits'
import { handleMcp } from './mcp'
import { RateLimiter } from './rate-limiter'
import { authorizedVapi, handleVapiTool, recordCall } from './vapi'

export { RateLimiter }

type Env = WorkerEnv & {
  RATE_LIMITER?: { idFromName(name: string): unknown; get(id: unknown): { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> } }
  VAPI_PRIVATE_KEY?: string
  VAPI_ORG_ID?: string
  VAPI_PUBLIC_KEY?: string
  VAPI_ASSISTANT_ID?: string
  PUBLIC_ORIGIN?: string
}

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }))
    try {
      await migrateD1(env.DB, __MIGRATIONS__)
      await seedReference(env.DB)
      const response = await route(request, env, url, ctx)
      return cors(response)
    } catch (error) {
      return cors(Response.json({ error: error instanceof Error ? error.message : 'worker error' }, { status: 500 }))
    }
  },
  async scheduled(_event: unknown, env: Env): Promise<void> {
    await migrateD1(env.DB, __MIGRATIONS__)
    await resetDemo(env.DB)
  },
}

async function route(request: Request, env: Env, url: URL, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
  if (url.pathname === '/health') return Response.json({ ok: true, service: 'meridian-worker' })
  if (url.pathname === '/mcp' && request.method === 'POST') return handleMcp(env.DB, env.MCP_BEARER_TOKEN || '', request)
  if (url.pathname === '/vapi/tool' && request.method === 'POST') {
    if (!(await authorizedVapi(request, env.VAPI_SECRET || ''))) return Response.json({ error: 'unauthorized' }, { status: 401 })
    return Response.json(await handleVapiTool(env.DB, await request.json()))
  }
  if (url.pathname === '/vapi/events' && request.method === 'POST') {
    if (!(await authorizedVapi(request, env.VAPI_SECRET || ''))) return Response.json({ error: 'unauthorized' }, { status: 401 })
    const id = await recordCall(env.DB, (await request.json()) as Record<string, unknown>)
    return Response.json({ id })
  }
  if (url.pathname === '/api/voice/session' && request.method === 'POST') return voiceSession(request, env)
  if (url.pathname === '/api/demo/reset' && request.method === 'POST') {
    if (!authorizedWorker(request, env)) return Response.json({ error: 'unauthorized' }, { status: 401 })
    await resetDemo(env.DB)
    return Response.json({ ok: true })
  }
  if (!authorizedWorker(request, env) && !url.pathname.startsWith('/api/public')) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (url.pathname === '/api/public/inquiries' && request.method === 'POST') return publicInquiry(request, env)
  if (url.pathname === '/api/inquiries' && request.method === 'GET') return Response.json({ inquiries: await listRows(env.DB, 'inquiries') })
  if (url.pathname === '/api/approvals' && request.method === 'GET') return Response.json({ approvals: await listRows(env.DB, 'approvals') })
  if (url.pathname === '/api/quotes' && request.method === 'GET') return Response.json({ quotes: await listRows(env.DB, 'quotes') })
  if (url.pathname === '/api/calls' && request.method === 'GET') return Response.json({ calls: await listRows(env.DB, 'calls') })
  if (url.pathname === '/api/audit' && request.method === 'GET') return Response.json({ audit: await listRows(env.DB, 'audit_log') })
  if (url.pathname === '/api/crm' && request.method === 'GET') return Response.json({ companies: await listRows(env.DB, 'crm_companies'), deals: await listRows(env.DB, 'crm_deals') })
  const step = url.pathname.match(/^\/api\/inquiries\/([^/]+)\/step$/)
  if (step && request.method === 'POST') {
    const result = await stepInquiry(env.DB, env, step[1])
    if (result.retry) ctx.waitUntil(stepInquiry(env.DB, env, step[1]))
    return Response.json(result)
  }
  return Response.json({ error: 'not_found' }, { status: 404 })
}

function authorizedWorker(request: Request, env: Env): boolean {
  const header = request.headers.get('authorization') ?? ''
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  return Boolean(env.WORKER_AUTH_TOKEN) && token === env.WORKER_AUTH_TOKEN
}

async function publicInquiry(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('x-visitor-ip') || request.headers.get('cf-connecting-ip') || 'unknown'
  const hash = await hashVisitor(ip, env.RATE_LIMIT_SALT || 'meridian')
  const ipOk = await takeWindow(env.DB, `form:${hash}`, 5, 10 * 60 * 1000)
  const dayOk = await takeDaily(env.DB, 'form', utcDay(), FORM_PER_DAY)
  const llmIp = await takeWindow(env.DB, `llm:${hash}`, LLM_PER_IP_DAY, 24 * 60 * 60 * 1000)
  const llmDay = await takeDaily(env.DB, 'llm', utcDay(), LLM_PER_DAY)
  if (!ipOk || !dayOk || !llmIp || !llmDay) {
    return Response.json({ error: 'Too many inquiries from this network today. Try again later.' }, { status: 429 })
  }
  const body = (await request.json()) as { name: string; email: string; company?: string; subject: string; message: string }
  const id = await createInquiry(env.DB, {
    source: 'web',
    fromName: body.name,
    fromEmail: body.email,
    companyName: body.company ?? null,
    subject: body.subject,
    body: body.message,
  })
  const stepped = await stepInquiry(env.DB, env, id)
  return Response.json({ id, ...stepped }, { status: 201 })
}

async function voiceSession(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('x-visitor-ip') || request.headers.get('cf-connecting-ip') || 'unknown'
  const hash = await hashVisitor(ip, env.RATE_LIMIT_SALT || 'meridian')
  if (env.RATE_LIMITER) {
    const id = env.RATE_LIMITER.idFromName('calls')
    const stub = env.RATE_LIMITER.get(id)
    const limited = await stub.fetch('https://limiter/calls', { method: 'POST', body: JSON.stringify({ hash }) })
    if (limited.status === 429) return Response.json({ error: 'The sales line is at its demo limit for now. You can still write to us from the form.' }, { status: 429 })
  } else {
    const ipOk = await takeWindow(env.DB, `call:${hash}`, CALLS_PER_IP, CALL_WINDOW_MS)
    const dayOk = await takeDaily(env.DB, 'calls', utcDay(), CALLS_PER_DAY)
    if (!ipOk || !dayOk) return Response.json({ error: 'The sales line is at its demo limit for now. You can still write to us from the form.' }, { status: 429 })
  }
  if (env.VAPI_PRIVATE_KEY && env.VAPI_ORG_ID) {
    const token = await signVapiPublicJwt({
      privateKey: env.VAPI_PRIVATE_KEY,
      orgId: env.VAPI_ORG_ID,
      assistantId: env.VAPI_ASSISTANT_ID,
      origin: env.PUBLIC_ORIGIN || 'https://sales.quvantic.com',
      ttlSeconds: 600,
    })
    return Response.json({ assistantId: env.VAPI_ASSISTANT_ID ?? '', token })
  }
  return Response.json({ assistantId: env.VAPI_ASSISTANT_ID ?? '', publicKey: env.VAPI_PUBLIC_KEY ?? '' })
}

async function resetDemo(db: Env['DB']): Promise<void> {
  for (const table of ['outbound_messages', 'agent_steps', 'approvals', 'quote_lines', 'quotes', 'calls', 'crm_deals', 'crm_contacts', 'crm_companies', 'audit_log', 'agent_runs', 'inquiries', 'daily_counters', 'rate_buckets']) {
    await db.prepare(`DELETE FROM ${table}`).bind().run()
  }
  await seedReference(db)
}

function cors(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-headers', 'authorization, content-type, x-visitor-ip, x-vapi-secret')
  headers.set('access-control-allow-methods', 'GET, POST, OPTIONS')
  return new Response(response.body, { status: response.status, headers })
}
