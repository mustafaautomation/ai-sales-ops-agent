import { searchChunks, allChunks, KB_DOCS } from '../../packages/core/src/kb'
import { computeQuote } from '../../packages/core/src/quote'
import { pickQuote } from '../../packages/core/src/picker'
import { secretsMatch } from '../../packages/core/src/vapi-jwt'
import { id } from '../../packages/core/src/ids'
import type { D1Like } from './d1'
import { createInquiry } from './desk'

export async function authorizedVapi(request: Request, secret: string): Promise<boolean> {
  const provided = request.headers.get('x-vapi-secret') ?? ''
  return secretsMatch(provided, secret)
}

export async function handleVapiTool(db: D1Like, body: unknown): Promise<{ results: { toolCallId: string; result: string }[] }> {
  const message = (body as { message?: { type?: string; call?: { id?: string }; toolCallList?: { id?: string; function?: { name?: string; arguments?: unknown } }[] } }).message
  const calls = message?.toolCallList ?? []
  const results = []
  for (const call of calls) {
    const name = call.function?.name ?? ''
    const args = typeof call.function?.arguments === 'string' ? safeJson(call.function.arguments) : (call.function?.arguments ?? {})
    results.push({ toolCallId: call.id ?? name, result: await runVoiceTool(db, name, args as Record<string, unknown>, message?.call?.id ?? null) })
  }
  return { results }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return {}
  }
}

async function runVoiceTool(db: D1Like, name: string, args: Record<string, unknown>, callId: string | null): Promise<string> {
  if (name === 'search_kb' || name === 'check_service_area') {
    const query = name === 'check_service_area' ? 'service area Cedarhaven' : String(args.query ?? 'services')
    const hits = searchChunks(allChunks(KB_DOCS), query, 3)
    return hits.map((hit) => `${hit.title} — ${hit.heading} (${hit.slug}): ${hit.content}`).join('\n\n') || 'No matching note.'
  }
  if (name === 'ballpark_quote') {
    const picked = pickQuote(String(args.request ?? ''))
    if (picked.lines.length === 0) return 'I need square feet, restrooms, windows, or hours before I can price this. I will not guess a price.'
    const quote = computeQuote({ lines: picked.lines, discountCode: picked.discountCode, taxBps: 825 })
    return `Ballpark total ${(quote.totalCents / 100).toFixed(2)} USD. This is not a formal quote. A formal quote is sent only after an operator approves it.`
  }
  if (name === 'capture_lead') {
    const email = String(args.email ?? 'caller@meridian-facilities.example')
    const inquiryId = await createInquiry(db, {
      source: 'voice',
      fromName: String(args.name ?? 'Caller'),
      fromEmail: email,
      companyName: args.company ? String(args.company) : null,
      subject: 'Call lead',
      body: String(args.notes ?? 'Captured from the sales line.'),
    })
    const runId = id('run')
    const at = Date.now()
    await db.prepare(
      `INSERT INTO agent_runs (id, inquiry_id, status, provider, disposition, summary, error, started_at, finished_at)
       VALUES (?, ?, 'awaiting_approval', 'voice', NULL, NULL, NULL, ?, NULL)`,
    ).bind(runId, inquiryId, at).run()
    const approvalId = id('apr')
    const proposed = {
      companyName: String(args.company ?? args.name ?? 'Caller'),
      contactName: String(args.name ?? 'Caller'),
      contactEmail: email,
      dealTitle: 'Sales line lead',
      stage: 'lead',
      amountCents: 0,
      quoteId: null,
      quoteNumber: null,
      inquiryId,
    }
    await db.prepare(
      `INSERT INTO approvals (id, run_id, tool_name, status, proposed_json, final_json, note, decided_by, created_at, decided_at)
       VALUES (?, ?, 'crm_upsert', 'pending', ?, NULL, ?, NULL, ?, NULL)`,
    ).bind(approvalId, runId, JSON.stringify(proposed), 'Voice lead. CRM write waits for an operator.', at).run()
    await db.prepare(`UPDATE inquiries SET status = 'awaiting_approval', updated_at = ? WHERE id = ?`).bind(at, inquiryId).run()
    if (callId) {
      await db.prepare('UPDATE calls SET inquiry_id = ?, company_name = ?, caller_name = ? WHERE vapi_call_id = ?').bind(inquiryId, args.company ?? null, args.name ?? null, callId).run()
    }
    return 'I have the details. An operator reviews the lead before it is written to the CRM. I have not sent a formal quote.'
  }
  return 'That action is not available on the sales line.'
}

function callStatus(message: Record<string, unknown>): string | null {
  const type = String(message.type ?? '')
  if (type === 'end-of-call-report' || type === 'hang') return 'ended'
  if (type === 'status-update') return String(message.status ?? 'in-progress')
  return null
}

export async function recordCall(db: D1Like, body: Record<string, unknown>): Promise<string> {
  const message = (body.message ?? body) as Record<string, unknown>
  const call = (message.call ?? {}) as Record<string, unknown>
  const callId = String(call.id ?? id('vapi'))
  const existing = await db.prepare('SELECT id FROM calls WHERE vapi_call_id = ?').bind(callId).first<{ id: string }>()
  const summary = typeof message.summary === 'string' ? message.summary : null
  const transcript = message.transcript != null || message.artifact != null ? JSON.stringify(message.transcript ?? message.artifact ?? '') : null
  const status = callStatus(message)
  const idValue = existing?.id ?? id('call')
  if (!existing) {
    await db.prepare(
      `INSERT INTO calls (id, vapi_call_id, visitor_hash, from_number, caller_name, company_name, inquiry_id, status, summary, transcript, outcome, started_at, ended_at, created_at)
       VALUES (?, ?, NULL, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      idValue,
      callId,
      call.customer ? JSON.stringify(call.customer) : null,
      status ?? 'started',
      summary,
      transcript,
      typeof message.endedReason === 'string' ? message.endedReason : null,
      Date.now(),
      status === 'ended' ? Date.now() : null,
      Date.now(),
    ).run()
    return idValue
  }
  const sets: string[] = []
  const values: unknown[] = []
  if (status) {
    sets.push('status = ?')
    values.push(status)
  }
  if (summary) {
    sets.push('summary = ?')
    values.push(summary)
  }
  if (transcript && transcript !== '""') {
    sets.push('transcript = ?')
    values.push(transcript)
  }
  if (typeof message.endedReason === 'string') {
    sets.push('outcome = ?')
    values.push(message.endedReason)
    sets.push('ended_at = ?')
    values.push(Date.now())
  }
  if (sets.length > 0) {
    values.push(idValue)
    await db.prepare(`UPDATE calls SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run()
  }
  return idValue
}
