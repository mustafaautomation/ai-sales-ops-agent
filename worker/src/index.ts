import { CALL_WINDOW_MS, CALLS_PER_DAY, CALLS_PER_IP, hashVisitor, utcDay } from '../../packages/core/src/limits'
import { signVapiPublicJwt } from '../../packages/core/src/vapi-jwt'
import { bearerMatches, visitorAddress } from './client-ip'
import { migrateD1 } from './d1'
import { decideApproval } from './decide'
import { driveInquiry, listRows, seedReference, syncOpen } from './desk'
import { takeDaily, takeWindow } from './limits'
import { handleMcp } from './mcp'
import { acceptPublicInquiry } from './public-inquiry'
import { RateLimiter } from './rate-limiter'
import { approvalDetail, callDetail, dashboard, inquiryDetail, knowledgeView, listApprovals, quoteDetail, runDetail, saveSettings, settingsView } from './read'
import { resetDemo, resetDemoAndLimits } from './reset'
import { clearSuppression, confirmOptIn, draftDueFollowUps, listSuppressions, suppressContact } from './outbound-flow'
import { kick, listStaleRuns, type DriveEnv } from './pipeline'
import { authorizedVapi, finishWebCall, handleVapiTool, linkWebCall, recordCall } from './vapi'

export { RateLimiter }

type Env = DriveEnv & {
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
      if (url.pathname !== '/api/internal/drive') ctx.waitUntil(resumeStale(request, env))
      return cors(response)
    } catch (error) {
      return cors(Response.json({ error: error instanceof Error ? error.message : 'worker error' }, { status: 500 }))
    }
  },
  async scheduled(_event: unknown, env: Env): Promise<void> {
    await migrateD1(env.DB, __MIGRATIONS__)
    await draftDueFollowUps(env.DB, env)
    await sweepInCron(env)
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
  if (url.pathname === '/api/voice/mode' && request.method === 'GET') {
    return Response.json({ mode: env.VAPI_PRIVATE_KEY && env.VAPI_ORG_ID ? 'token' : 'public-key' })
  }
  if (url.pathname === '/api/voice/session' && request.method === 'POST') return voiceSession(request, env)
  if (url.pathname === '/api/demo/reset' && request.method === 'POST') {
    if (!bearerMatches(request, env.WORKER_AUTH_TOKEN)) return Response.json({ error: 'unauthorized' }, { status: 401 })
    await resetDemoAndLimits(env.DB, env.RATE_LIMITER)
    return Response.json({ ok: true })
  }
  if (!bearerMatches(request, env.WORKER_AUTH_TOKEN) && !url.pathname.startsWith('/api/public')) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const leadCall = url.pathname.match(/^\/api\/public\/call-context$/)
  if (leadCall && request.method === 'GET') {
    const { verifyDeskToken } = await import('../../packages/core/src/outbound')
    const checked = await verifyDeskToken(env.SESSION_SECRET || env.WORKER_AUTH_TOKEN || 'meridian-desk', url.searchParams.get('token') ?? '')
    if (!checked.ok || checked.payload.purpose !== 'call') return Response.json({ error: 'invalid' }, { status: 400 })
    const inquiry = await env.DB.prepare('SELECT from_name, company_name, subject, suppressed_at FROM inquiries WHERE id = ?').bind(checked.payload.inquiryId).first<{ from_name: string; company_name: string | null; subject: string; suppressed_at: number | null }>()
    if (!inquiry || inquiry.suppressed_at) return Response.json({ error: 'unavailable' }, { status: 404 })
    return Response.json({ name: inquiry.from_name, company: inquiry.company_name ?? '', subject: inquiry.subject })
  }
  if (url.pathname === '/api/public/opt-in' && request.method === 'GET') {
    const result = await confirmOptIn(env.DB, env, url.searchParams.get('token') ?? '')
    if (result.ok && !result.already && result.inquiryId) ctx.waitUntil(kick(request, env, result.inquiryId))
    return Response.json(result, { status: result.ok ? 200 : 400 })
  }
  if (url.pathname === '/api/public/unsubscribe' && request.method === 'GET') {
    const result = await suppressContact(env.DB, env, { token: url.searchParams.get('token') ?? '' })
    return Response.json(result, { status: result.ok ? 200 : 400 })
  }
  if (url.pathname === '/api/integrations' && request.method === 'GET') {
    return Response.json({ ...integrationStatus(env), suppressions: await listSuppressions(env.DB) })
  }
  if (url.pathname === '/api/suppressions' && request.method === 'POST') {
    const body = (await request.json()) as { email?: string }
    return Response.json(await clearSuppression(env.DB, String(body.email ?? ''), 'operator'))
  }
  if (url.pathname === '/api/outbox' && request.method === 'GET') {
    const email = await env.DB.prepare(`SELECT id, inquiry_id, to_email, subject, status, provider, provider_message_id, error, created_at FROM outbound_messages ORDER BY created_at DESC LIMIT 100`).bind().all()
    const calls = await env.DB.prepare(`SELECT id, inquiry_id, phone, mode, status, summary, created_at FROM outbound_calls ORDER BY created_at DESC LIMIT 100`).bind().all()
    return Response.json({ email: email.results, calls: calls.results })
  }
  if (url.pathname === '/api/public/call-started' && request.method === 'POST') {
    const body = (await request.json()) as { token?: string; vapiCallId?: string }
    const linked = await linkWebCall(env.DB, env, String(body.token ?? ''), String(body.vapiCallId ?? ''))
    return Response.json(linked, { status: linked.ok ? 200 : 400 })
  }
  if (url.pathname === '/api/public/call-ended' && request.method === 'POST') {
    const body = (await request.json()) as { token?: string; vapiCallId?: string; endedAt?: number }
    const finished = await finishWebCall(env.DB, env, String(body.token ?? ''), String(body.vapiCallId ?? ''), body.endedAt)
    return Response.json(finished, { status: finished.ok ? 200 : 400 })
  }
  if (url.pathname === '/api/public/inquiries' && request.method === 'POST') {
    const body = (await request.json()) as { name?: string; email?: string; company?: string; subject?: string; message?: string }
    const response = await acceptPublicInquiry(env.DB, env, body, visitorAddress(request, env.WORKER_AUTH_TOKEN), ctx)
    const continueId = response.headers.get('x-continue-inquiry')
    if (continueId) ctx.waitUntil(kick(request, env, continueId))
    return response
  }
  if (url.pathname === '/api/internal/drive' && request.method === 'POST') {
    const inquiryId = url.searchParams.get('inquiry') ?? ''
    if (!inquiryId) return Response.json({ error: 'missing inquiry' }, { status: 400 })
    // Finish this hop's model work in this invocation (5–20s) before returning.
    // Only then schedule the next SELF hop via waitUntil, so a canceled waitUntil
    // cannot cut short an in-flight Workers AI call. See kick() in pipeline.ts.
    const result = await driveInquiry(env.DB, env, inquiryId, 1)
    if (result.status === 'running' && !result.busy) {
      ctx.waitUntil(kick(request, env, inquiryId))
    }
    return Response.json({ accepted: true, ...result }, { status: 202 })
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
    const result = await driveInquiry(env.DB, env, step[1], 1)
    if (result.status === 'running' && !result.busy) ctx.waitUntil(kick(request, env, step[1]))
    return Response.json(result)
  }
  const inquiry = url.pathname.match(/^\/api\/inquiries\/([^/]+)$/)
  if (inquiry && request.method === 'GET') return jsonOr404(await inquiryDetail(env.DB, inquiry[1]))
  const run = url.pathname.match(/^\/api\/runs\/([^/]+)$/)
  if (run && request.method === 'GET') return jsonOr404(await runDetail(env.DB, run[1]))
  const decision = url.pathname.match(/^\/api\/approvals\/([^/]+)\/decide$/)
  if (decision && request.method === 'POST') return decideRoute(request, env, decision[1], ctx)
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

async function decideRoute(request: Request, env: Env, approvalId: string, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
  try {
    const body = (await request.json()) as { decision?: string; finalJson?: string; actor?: string }
    if (body.decision !== 'approved' && body.decision !== 'rejected') return Response.json({ error: 'decision must be approved or rejected' }, { status: 400 })
    const result = await decideApproval(env.DB, env, {
      approvalId,
      decision: body.decision,
      finalJson: body.finalJson ?? null,
      actor: body.actor || 'operator',
    })
    if (result.status === 'running' && result.inquiryId) ctx.waitUntil(kick(request, env, String(result.inquiryId)))
    return Response.json(result)
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'decision failed' }, { status: 400 })
  }
}

async function resumeStale(request: Request, env: Env): Promise<void> {
  const stale = await listStaleRuns(env.DB)
  for (const inquiryId of stale) await kick(request, env, inquiryId)
}

async function sweepInCron(env: Env): Promise<void> {
  const stale = await listStaleRuns(env.DB)
  for (const inquiryId of stale) {
    let status = 'running'
    for (let step = 0; status === 'running' && step < 12; step += 1) {
      const result = await driveInquiry(env.DB, env, inquiryId, 1)
      if (result.busy) break
      status = String(result.status ?? 'running')
    }
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

function integrationStatus(env: Env) {
  return {
    resendKeyPresent: Boolean(env.RESEND_API_KEY),
    emailEnabled: env.OUTBOUND_EMAIL_ENABLED === 'true',
    emailFrom: env.EMAIL_FROM || 'Meridian Desk <desk@quvantic.com>',
    callsEnabled: env.OUTBOUND_CALLS_ENABLED === 'true',
    callMode: env.OUTBOUND_CALLS_ENABLED === 'true' && env.VAPI_PRIVATE_KEY && env.VAPI_OUTBOUND_PHONE_NUMBER_ID ? 'phone' : 'browser',
    outboundNumberConfigured: Boolean(env.VAPI_OUTBOUND_PHONE_NUMBER_ID),
    geminiConfigured: Boolean(env.GEMINI_API_KEY),
    geminiModel: env.GEMINI_MODEL || 'gemini-2.5-flash',
    caps: { emailsPerAddress: 2, emailsGlobal: 50, callsPerNumber: 1, callsGlobal: 10 },
  }
}

function cors(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-headers', 'authorization, content-type, x-visitor-ip, x-vapi-secret')
  headers.set('access-control-allow-methods', 'GET, POST, OPTIONS')
  return new Response(response.body, { status: response.status, headers })
}
