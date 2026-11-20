import { emailAllowed, emailHtml, chooseSender, callAllowed, callbackMode, signDeskToken, verifyDeskToken, shouldDraftFollowUp } from '../../packages/core/src/outbound'
import { id } from '../../packages/core/src/ids'
import type { D1Like } from './d1'
import type { WorkerEnv } from './desk'
import { driveInquiry } from './desk'

async function one<T>(db: D1Like, sql: string, ...args: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...args).first<T>()
}

function fromAddress(env: WorkerEnv): string {
  return env.EMAIL_FROM || 'Meridian Desk <desk@quvantic.com>'
}

function origin(env: WorkerEnv): string {
  return (env.PUBLIC_ORIGIN || 'https://sales.quvantic.com').replace(/\/$/, '')
}

export async function deliverApprovedEmail(
  db: D1Like,
  env: WorkerEnv,
  inquiry: Record<string, string | number | null>,
  approvalId: string,
  args: Record<string, unknown>,
): Promise<{ messageId: string; status: string; provider: string; error: string | null }> {
  const to = String(inquiry.from_email)
  if (String(args.to ?? '').toLowerCase() !== to.toLowerCase()) {
    throw new Error('The recipient is fixed to the inquiry sender.')
  }
  const existing = await one<{ id: string }>(db, 'SELECT id FROM outbound_messages WHERE approval_id = ?', approvalId)
  if (existing) return { messageId: existing.id, status: 'sandbox', provider: 'sandbox', error: null }
  const since = Date.now() - 24 * 60 * 60 * 1000
  const addressCount = (await one<{ n: number }>(db, `SELECT count(*) AS n FROM outbound_messages WHERE lower(to_email) = ? AND status = 'sent' AND created_at > ?`, to.toLowerCase(), since))?.n ?? 0
  const globalCount = (await one<{ n: number }>(db, `SELECT count(*) AS n FROM outbound_messages WHERE status = 'sent' AND created_at > ?`, since))?.n ?? 0
  const verified = Number(inquiry.email_verified_at) > 0 && String(inquiry.source) === 'web'
  const suppressed = Number(inquiry.suppressed_at) > 0
  const enabled = env.OUTBOUND_EMAIL_ENABLED === 'true'
  const gate = emailAllowed({ enabled, suppressed, verified, addressCount, globalCount })
  const text = String(args.body ?? '')
  let status = 'sandbox'
  let provider = 'sandbox'
  let providerId: string | null = null
  let error: string | null = gate.ok ? null : gate.reason
  if (gate.ok) {
    const sender = chooseSender({ enabled: true, apiKey: env.RESEND_API_KEY, fetchImpl: fetch })
    const result = await sender.send({
      to,
      from: fromAddress(env),
      replyTo: env.EMAIL_REPLY_TO,
      subject: String(args.subject ?? ''),
      text,
      html: emailHtml(text),
    })
    provider = 'resend'
    if (result.ok) {
      status = 'sent'
      providerId = result.id
      error = null
    } else {
      status = 'failed'
      error = result.reason
    }
  }
  const messageId = id('out')
  await db.prepare(
    `INSERT INTO outbound_messages (id, approval_id, inquiry_id, quote_id, to_email, subject, body, provider_message_id, status, created_at, provider, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(messageId, approvalId, inquiry.id, args.quoteId ?? null, to, args.subject, text, providerId, status, Date.now(), provider, error).run()
  if (args.quoteId && status !== 'failed') await db.prepare(`UPDATE quotes SET status = 'sent' WHERE id = ?`).bind(args.quoteId).run()
  return { messageId, status, provider, error }
}

export async function sendOptIn(db: D1Like, env: WorkerEnv, inquiryId: string, email: string, name: string): Promise<void> {
  const secret = env.SESSION_SECRET || env.WORKER_AUTH_TOKEN || 'meridian-desk'
  const exp = Date.now() + 48 * 60 * 60 * 1000
  const token = await signDeskToken(secret, { inquiryId, email, purpose: 'opt-in', exp })
  const stop = await signDeskToken(secret, { inquiryId, email, purpose: 'unsubscribe', exp: Date.now() + 180 * 24 * 60 * 60 * 1000 })
  const link = `${origin(env)}/api/public/opt-in?token=${encodeURIComponent(token)}`
  const text = `Hello ${name.split(' ')[0] || 'there'},\n\nConfirm this address so Meridian Facilities can email you about your inquiry:\n${link}\n\nTo stop all contact: ${origin(env)}/api/public/unsubscribe?token=${encodeURIComponent(stop)}\n\nMeridian Facilities sales desk\nCedarhaven`
  const enabled = env.OUTBOUND_EMAIL_ENABLED === 'true' && Boolean(env.RESEND_API_KEY)
  const sender = chooseSender({ enabled, apiKey: env.RESEND_API_KEY, fetchImpl: fetch })
  const result = await sender.send({ to: email, from: fromAddress(env), replyTo: env.EMAIL_REPLY_TO, subject: 'Confirm your email', text, html: emailHtml(text) })
  await db.prepare(
    `INSERT INTO outbound_messages (id, approval_id, inquiry_id, quote_id, to_email, subject, body, provider_message_id, status, created_at, provider, error)
     VALUES (?, NULL, ?, NULL, ?, 'Confirm your email', ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id('out'),
    inquiryId,
    email,
    text,
    result.ok ? result.id : null,
    result.ok ? (enabled ? 'sent' : 'sandbox') : 'failed',
    Date.now(),
    enabled ? 'resend' : 'sandbox',
    result.ok ? null : result.reason,
  ).run()
  await db.prepare(
    `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, detail) VALUES (?, ?, 'agent', 'optin.sent', 'inquiry', ?, ?)`,
  ).bind(id('aud'), Date.now(), inquiryId, JSON.stringify({ email })).run()
}

export async function confirmOptIn(db: D1Like, env: WorkerEnv, token: string): Promise<{ ok: boolean; inquiryId?: string; reason?: string }> {
  const secret = env.SESSION_SECRET || env.WORKER_AUTH_TOKEN || 'meridian-desk'
  const checked = await verifyDeskToken(secret, token)
  if (!checked.ok || checked.payload.purpose !== 'opt-in') return { ok: false, reason: checked.ok ? 'wrong token' : checked.reason }
  const at = Date.now()
  await db.prepare(`UPDATE inquiries SET email_verified_at = ?, status = 'processing', updated_at = ? WHERE id = ? AND email_verified_at IS NULL`).bind(at, at, checked.payload.inquiryId).run()
  await db.prepare(
    `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, detail) VALUES (?, ?, 'lead', 'email.verified', 'inquiry', ?, ?)`,
  ).bind(id('aud'), at, checked.payload.inquiryId, JSON.stringify({ at })).run()
  await driveInquiry(db, env, checked.payload.inquiryId, 8)
  return { ok: true, inquiryId: checked.payload.inquiryId }
}

export async function suppressContact(db: D1Like, env: WorkerEnv, tokenOrEmail: { token?: string; email?: string }): Promise<{ ok: boolean }> {
  const at = Date.now()
  let inquiryId: string | null = null
  if (tokenOrEmail.token) {
    const secret = env.SESSION_SECRET || env.WORKER_AUTH_TOKEN || 'meridian-desk'
    const checked = await verifyDeskToken(secret, tokenOrEmail.token)
    if (!checked.ok) return { ok: false }
    inquiryId = checked.payload.inquiryId
    await db.prepare(`UPDATE inquiries SET suppressed_at = ?, updated_at = ? WHERE id = ?`).bind(at, at, inquiryId).run()
  } else if (tokenOrEmail.email) {
    await db.prepare(`UPDATE inquiries SET suppressed_at = ?, updated_at = ? WHERE lower(from_email) = ?`).bind(at, at, tokenOrEmail.email.toLowerCase()).run()
    const row = await one<{ id: string }>(db, 'SELECT id FROM inquiries WHERE lower(from_email) = ? ORDER BY created_at DESC LIMIT 1', tokenOrEmail.email.toLowerCase())
    inquiryId = row?.id ?? tokenOrEmail.email
  }
  if (inquiryId) {
    await db.prepare(
      `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, detail) VALUES (?, ?, 'lead', 'contact.suppressed', 'inquiry', ?, '{}')`,
    ).bind(id('aud'), at, inquiryId).run()
  }
  return { ok: true }
}

export async function draftDueFollowUps(db: D1Like, env: WorkerEnv, now = Date.now()): Promise<number> {
  const days = Number(env.FOLLOW_UP_AFTER_DAYS || '2')
  const rows = await db.prepare(
    `SELECT inquiries.id, inquiries.from_email, inquiries.from_name, inquiries.company_name, inquiries.email_verified_at, inquiries.suppressed_at, quotes.id AS quote_id, quotes.number, outbound_messages.created_at AS sent_at
     FROM inquiries
     JOIN quotes ON quotes.inquiry_id = inquiries.id AND quotes.status = 'sent'
     JOIN outbound_messages ON outbound_messages.quote_id = quotes.id AND outbound_messages.status IN ('sent', 'sandbox')
     WHERE inquiries.email_verified_at IS NOT NULL AND inquiries.suppressed_at IS NULL`,
  ).bind().all<{ id: string; from_email: string; from_name: string; company_name: string | null; email_verified_at: number; suppressed_at: number | null; quote_id: string; number: string; sent_at: number }>()
  let drafted = 0
  for (const row of rows.results) {
    const existing = await one<{ id: string }>(db, `SELECT id FROM approvals WHERE run_id IN (SELECT id FROM agent_runs WHERE inquiry_id = ?) AND proposed_json LIKE '%"follow_up"%'`, row.id)
    if (!shouldDraftFollowUp({ verified: true, suppressed: false, sentAt: row.sent_at, now, days, alreadyDrafted: Boolean(existing) })) continue
    const run = await one<{ id: string }>(db, 'SELECT id FROM agent_runs WHERE inquiry_id = ? ORDER BY started_at DESC LIMIT 1', row.id)
    if (!run) continue
    const approvalId = id('apr')
    const body = `Hello ${row.from_name.split(' ')[0] || 'there'},\n\nQuote ${row.number} is still open. Reply if you want it revised or booked.\n\nMeridian Facilities sales desk\nCedarhaven`
    await db.prepare(
      `INSERT INTO approvals (id, run_id, tool_name, status, proposed_json, final_json, note, decided_by, created_at, decided_at)
       VALUES (?, ?, 'send_email', 'pending', ?, NULL, ?, NULL, ?, NULL)`,
    ).bind(
      approvalId,
      run.id,
      JSON.stringify({ to: row.from_email, subject: `Following up on ${row.number}`, body, purpose: 'follow_up', quoteId: row.quote_id }),
      'Follow-up: the quote was sent and has not been booked. This draft waits for approval.',
      now,
    ).run()
    drafted += 1
  }
  return drafted
}

export async function placeCallback(
  db: D1Like,
  env: WorkerEnv,
  input: { inquiryId: string; phone: string; approvalId: string },
): Promise<{ mode: 'phone' | 'browser'; status: string; when?: number }> {
  const inquiry = await one<Record<string, string | number | null>>(db, 'SELECT * FROM inquiries WHERE id = ?', input.inquiryId)
  if (!inquiry) return { mode: 'browser', status: 'missing' }
  if (Number(inquiry.suppressed_at) > 0) return { mode: 'browser', status: 'suppressed' }
  const since = Date.now() - 24 * 60 * 60 * 1000
  const numberCount = (await one<{ n: number }>(db, `SELECT count(*) AS n FROM outbound_calls WHERE phone = ? AND created_at > ?`, input.phone, since))?.n ?? 0
  const globalCount = (await one<{ n: number }>(db, `SELECT count(*) AS n FROM outbound_calls WHERE created_at > ?`, since))?.n ?? 0
  const gate = callAllowed({
    enabled: true,
    suppressed: false,
    phone: input.phone,
    numberCount,
    ipCount: 0,
    globalCount,
    timeZone: String(inquiry.timezone || env.CALL_WINDOW_TZ || 'Asia/Kuala_Lumpur'),
  })
  if (!gate.ok) return { mode: 'browser', status: gate.reason }
  const mode = callbackMode({
    callsEnabled: env.OUTBOUND_CALLS_ENABLED === 'true',
    privateKey: env.VAPI_PRIVATE_KEY,
    phoneNumberId: env.VAPI_OUTBOUND_PHONE_NUMBER_ID,
  })
  const callId = id('ocall')
  if (gate.when.getTime() > Date.now() + 60_000) {
    await db.prepare(
      `INSERT INTO outbound_calls (id, inquiry_id, approval_id, phone, mode, status, vapi_call_id, scheduled_at, started_at, ended_at, summary, created_at)
       VALUES (?, ?, ?, ?, ?, 'scheduled', NULL, ?, NULL, NULL, NULL, ?)`,
    ).bind(callId, input.inquiryId, input.approvalId, gate.phone, mode, gate.when.getTime(), Date.now()).run()
    return { mode, status: 'scheduled', when: gate.when.getTime() }
  }
  if (mode === 'phone' && env.VAPI_PRIVATE_KEY && env.VAPI_ASSISTANT_ID && env.VAPI_OUTBOUND_PHONE_NUMBER_ID) {
    const response = await fetch('https://api.vapi.ai/call', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.VAPI_PRIVATE_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        assistantId: env.VAPI_ASSISTANT_ID,
        phoneNumberId: env.VAPI_OUTBOUND_PHONE_NUMBER_ID,
        customer: { number: gate.phone, name: inquiry.from_name },
        assistantOverrides: {
          variableValues: { name: inquiry.from_name, company: inquiry.company_name, subject: inquiry.subject },
          maxDurationSeconds: 210,
        },
      }),
    })
    const payload = (await response.json().catch(() => ({}))) as { id?: string }
    await db.prepare(
      `INSERT INTO outbound_calls (id, inquiry_id, approval_id, phone, mode, status, vapi_call_id, scheduled_at, started_at, ended_at, summary, created_at)
       VALUES (?, ?, ?, ?, 'phone', ?, ?, NULL, ?, NULL, NULL, ?)`,
    ).bind(callId, input.inquiryId, input.approvalId, gate.phone, response.ok ? 'started' : 'failed', payload.id ?? null, Date.now(), Date.now()).run()
    await db.prepare(
      `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, detail) VALUES (?, ?, 'agent', 'call.started', 'inquiry', ?, ?)`,
    ).bind(id('aud'), Date.now(), input.inquiryId, JSON.stringify({ mode: 'phone', vapiCallId: payload.id ?? null })).run()
    return { mode, status: response.ok ? 'started' : 'failed' }
  }
  const secret = env.SESSION_SECRET || env.WORKER_AUTH_TOKEN || 'meridian-desk'
  const token = await signDeskToken(secret, { inquiryId: input.inquiryId, email: String(inquiry.from_email), purpose: 'call', exp: Date.now() + 48 * 60 * 60 * 1000 })
  const link = `${origin(env)}/call/${token}`
  const text = `Hello ${String(inquiry.from_name).split(' ')[0] || 'there'},\n\nTalk to the Meridian assistant about ${inquiry.subject}:\n${link}\n\nThe link expires in two days.\n\nMeridian Facilities sales desk\nCedarhaven`
  const enabled = env.OUTBOUND_EMAIL_ENABLED === 'true' && Boolean(env.RESEND_API_KEY)
  const sender = chooseSender({ enabled, apiKey: env.RESEND_API_KEY, fetchImpl: fetch })
  await sender.send({ to: String(inquiry.from_email), from: fromAddress(env), subject: 'Talk to Meridian now', text, html: emailHtml(text) })
  await db.prepare(
    `INSERT INTO outbound_calls (id, inquiry_id, approval_id, phone, mode, status, vapi_call_id, scheduled_at, started_at, ended_at, summary, created_at)
     VALUES (?, ?, ?, ?, 'browser', 'link_sent', NULL, NULL, NULL, NULL, ?, ?)`,
  ).bind(callId, input.inquiryId, input.approvalId, gate.phone, link, Date.now()).run()
  return { mode: 'browser', status: 'link_sent' }
}
