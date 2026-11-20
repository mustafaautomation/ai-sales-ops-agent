import { CALL_WINDOW_MS, CALLS_PER_DAY, CALLS_PER_IP, hashVisitor, utcDay } from '../../packages/core/src/limits'
import { signVapiPublicJwt } from '../../packages/core/src/vapi-jwt'
import { bearerMatches, visitorAddress } from './client-ip'
import { migrateD1 } from './d1'
import { decideApproval } from './decide'
import { driveInquiry, listRows, seedReference, syncOpen, type WorkerEnv } from './desk'
import { takeDaily, takeWindow } from './limits'
import { handleMcp } from './mcp'
import { acceptPublicInquiry } from './public-inquiry'
import { RateLimiter } from './rate-limiter'
import { approvalDetail, callDetail, dashboard, inquiryDetail, knowledgeView, listApprovals, quoteDetail, runDetail, saveSettings, settingsView } from './read'
import { resetDemo } from './reset'
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
  if (url.pathname === '/mcp' && request.method === 'POST') return handleMcp(env.DB, env.MCP_BEARER_TOKEN || '', request, env)
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
    if (!bearerMatches(request, env.WORKER_AUTH_TOKEN)) return Response.json({ error: 'unauthorized' }, { status: 401 })
    await resetDemo(env.DB)
    return Response.json({ ok: true })
  }
  if (!bearerMatches(request, env.WORKER_AUTH_TOKEN) && !url.pathname.startsWith('/api/public')) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (url.pathname === '/api/public/inquiries' && request.method === 'POST') {
    const body = (await request.json()) as { name?: string; email?: string; company?: string; subject?: string; message?: string }
    return acceptPublicInquiry(env.DB, env, body, visitorAddress(request, env.WORKER_AUTH_TOKEN), ctx)
  }
  if (url.pathname === '/api/dashboard' && request.method === 'GET') return Response.json(await dashboard(env.DB))
  if (url.pathname === '/api/settings' && request.method === 'GET') return Response.json(await settingsView(env.DB))
  if (url.pathname === '/api/settings' && request.method === 'POST') return updateSettings(request, env)
  if (url.pathname === '/api/kb' && request.method === 'GET') return Response.json(knowledgeView({ doc: url.searchParams.get('doc'), q: url.searchParams.get('q') }))
  if (url.pathname === '/api/inbox/sync' && request.method === 'POST') return Response.json(await syncOpen(env.DB, env))
  if (url.pathname === '/api/inquiries' && request.method === 'GET') return Response.json({ inquiries: await listRows(env.DB, 'inquiries') })
  if (url.pathname === '/api/approvals' && request.method === 'GET') return Response.json({ approvals: await listApprovals(env.DB) })
  if (url.pathname === '/api/quotes' && request.method === 'GET') return Response.json({ quotes: await listRows(env.DB, 'quotes') })
  if (url.pathname === '/api/calls' && request.method === 'GET') return Response.json({ calls: await listRows(env.DB, 'calls') })
  if (url.pathname === '/api/audit' && request.method === 'GET') return Response.json({ audit: await listRows(env.DB, 'audit_log') })
  if (url.pathname === '/api/crm' && request.method === 'GET') {
    return Response.json({
      companies: await listRows(env.DB, 'crm_companies'),
      deals: await listRows(env.DB, 'crm_deals'),
      contacts: await listRows(env.DB, 'crm_contacts'),
    })
  }
  const rerun = url.pathname.match(/^\/api\/inquiries\/([^/]+)\/rerun$/)
  if (rerun && request.method === 'POST') return Response.json(await driveInquiry(env.DB, env, rerun[1], 8, { forceNew: true }))
  const step = url.pathname.match(/^\/api\/inquiries\/([^/]+)\/step$/)
  if (step && request.method === 'POST') {
    const result = await driveInquiry(env.DB, env, step[1], 8)
    if (result.status === 'running') ctx.waitUntil(driveInquiry(env.DB, env, step[1], 8))
    return Response.json(result)
  }
  const inquiry = url.pathname.match(/^\/api\/inquiries\/([^/]+)$/)
  if (inquiry && request.method === 'GET') return jsonOr404(await inquiryDetail(env.DB, inquiry[1]))
  const run = url.pathname.match(/^\/api\/runs\/([^/]+)$/)
  if (run && request.method === 'GET') return jsonOr404(await runDetail(env.DB, run[1]))
  const decision = url.pathname.match(/^\/api\/approvals\/([^/]+)\/decide$/)
  if (decision && request.method === 'POST') return decideRoute(request, env, decision[1])
  const approval = url.pathname.match(/^\/api\/approvals\/([^/]+)$/)
  if (approval && request.method === 'GET') return jsonOr404(await approvalDetail(env.DB, approval[1]))
  const quote = url.pathname.match(/^\/api\/quotes\/([^/]+)$/)
  if (quote && request.method === 'GET') return jsonOr404(await quoteDetail(env.DB, quote[1]))
  const call = url.pathname.match(/^\/api\/calls\/([^/]+)$/)
  if (call && request.method === 'GET') return jsonOr404(await callDetail(env.DB, call[1]))
  return Response.json({ error: 'not_found' }, { status: 404 })
}

function jsonOr404(payload: unknown): Response {
  if (!payload) return Response.json({ error: 'not_found' }, { status: 404 })
  return Response.json(payload)
}

async function decideRoute(request: Request, env: Env, approvalId: string): Promise<Response> {
  try {
    const body = (await request.json()) as { decision?: string; finalJson?: string; actor?: string }
    if (body.decision !== 'approved' && body.decision !== 'rejected') return Response.json({ error: 'decision must be approved or rejected' }, { status: 400 })
    const result = await decideApproval(env.DB, env, {
      approvalId,
      decision: body.decision,
      finalJson: body.finalJson ?? null,
      actor: body.actor || 'operator',
    })
    return Response.json(result)
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'decision failed' }, { status: 400 })
  }
}

async function updateSettings(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as { taxBps?: number; quoteValidDays?: number }
    await saveSettings(env.DB, Number(body.taxBps), Number(body.quoteValidDays))
    return Response.json({ ok: true })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'settings failed' }, { status: 400 })
  }
}

async function voiceSession(request: Request, env: Env): Promise<Response> {
  const ip = visitorAddress(request, env.WORKER_AUTH_TOKEN)
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
    return Response.json({ mode: 'token', assistantId: env.VAPI_ASSISTANT_ID ?? '', token })
  }
  return Response.json({ mode: 'public-key', assistantId: env.VAPI_ASSISTANT_ID ?? '', publicKey: env.VAPI_PUBLIC_KEY ?? '' })
}

function cors(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-headers', 'authorization, content-type, x-visitor-ip, x-vapi-secret')
  headers.set('access-control-allow-methods', 'GET, POST, OPTIONS')
  return new Response(response.body, { status: response.status, headers })
}
