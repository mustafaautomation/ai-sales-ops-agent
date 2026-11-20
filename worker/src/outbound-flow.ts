import { emailAllowed, emailHtml, chooseSender, callAllowed, callbackMode, signDeskToken, verifyDeskToken, shouldDraftFollowUp, confirmUrl, unsubscribeUrl, callPageUrl, withUnsubscribe, normalizeEmail, parseE164 } from '../../packages/core/src/outbound'
import { id } from '../../packages/core/src/ids'
import type { D1Like } from './d1'
import type { WorkerEnv } from './desk'

async function one<T>(db: D1Like, sql: string, ...args: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...args).first<T>()
}

function fromAddress(env: WorkerEnv): string {
  return env.EMAIL_FROM || 'Meridian Desk <desk@quvantic.com>'
}

function origin(env: WorkerEnv): string {
  return (env.PUBLIC_ORIGIN || 'https://sales.quvantic.com').replace(/\/$/, '')
}

function secretOf(env: WorkerEnv): string {
  return env.SESSION_SECRET || env.WORKER_AUTH_TOKEN || 'meridian-desk'
}

export async function isSuppressed(db: D1Like, email?: string | null, phone?: string | null): Promise<boolean> {
  if (email) {
    const row = await one<{ id: string }>(db, `SELECT id FROM suppressions WHERE kind = 'email' AND value = ? AND cleared_at IS NULL`, normalizeEmail(email))
    if (row) return true
  }
  const e164 = phone ? parseE164(phone) : null
  if (e164) {
    const row = await one<{ id: string }>(db, `SELECT id FROM suppressions WHERE kind = 'phone' AND value = ? AND cleared_at IS NULL`, e164)
    if (row) return true
  }
  return false
}

async function rememberSuppression(db: D1Like, kind: 'email' | 'phone', value: string): Promise<void> {
  const existing = await one<{ id: string }>(db, `SELECT id FROM suppressions WHERE kind = ? AND value = ? AND cleared_at IS NULL`, kind, value)
  if (existing) return
  await db.prepare(`INSERT INTO suppressions (id, kind, value, created_at, cleared_at) VALUES (?, ?, ?, ?, NULL)`).bind(id('sup'), kind, value, Date.now()).run()
}

export async function stopFooter(env: WorkerEnv, inquiryId: string, email: string, text: string): Promise<string> {
  const stop = await signDeskToken(secretOf(env), { inquiryId, email, purpose: 'unsubscribe', exp: Date.now() + 180 * 24 * 60 * 60 * 1000 })
  return withUnsubscribe(text, unsubscribeUrl(origin(env), stop))
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
  const suppressed = await isSuppressed(db, to, inquiry.phone ? String(inquiry.phone) : null)
  const enabled = env.OUTBOUND_EMAIL_ENABLED === 'true'
  const gate = emailAllowed({ enabled, suppressed, verified, addressCount, globalCount })
  const rawBody = String(args.body ?? '')
  const text = /stop all contact/i.test(rawBody) ? rawBody : await stopFooter(env, String(inquiry.id), to, rawBody)
  let status = 'sandbox'
  let provider = 'sandbox'
  let providerId: string | null = null
  let error: string | null = null
  if (suppressed) {
    status = 'blocked_suppressed'
    error = 'suppressed'
  } else if (verified && !enabled) {
    status = 'blocked_disabled'
    error = 'sending is off'
  } else if (gate.ok) {
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
  if (args.quoteId && (status === 'sent' || status === 'sandbox')) await db.prepare(`UPDATE quotes SET status = 'sent' WHERE id = ?`).bind(args.quoteId).run()
  return { messageId, status, provider, error }
}

export async function sendOptIn(db: D1Like, env: WorkerEnv, inquiryId: string, email: string, name: string): Promise<{ ok: true } | { ok: false; status: number; reason: string }> {
  if (await isSuppressed(db, email)) return { ok: false, status: 403, reason: 'suppressed' }
  const secret = secretOf(env)
  const exp = Date.now() + 48 * 60 * 60 * 1000
  const token = await signDeskToken(secret, { inquiryId, email, purpose: 'opt-in', exp })
  const link = confirmUrl(origin(env), token)
  const text = await stopFooter(env, inquiryId, email, `Hello ${name.split(' ')[0] || 'there'},\n\nConfirm this address so Meridian Facilities can email you about your inquiry:\n${link}\n\nMeridian Facilities sales desk\nCedarhaven`)
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
  return { ok: true }
}

export async function confirmOptIn(db: D1Like, env: WorkerEnv, token: string): Promise<{ ok: boolean; already?: boolean; inquiryId?: string; name?: string; company?: string; subject?: string; email?: string; reason?: string }> {
  const checked = await verifyDeskToken(secretOf(env), token)
  if (!checked.ok || checked.payload.purpose !== 'opt-in') return { ok: false, reason: checked.ok ? 'wrong token' : checked.reason }
  const inquiry = await one<{ from_name: string; company_name: string | null; subject: string; email_verified_at: number | null }>(db, 'SELECT from_name, company_name, subject, email_verified_at FROM inquiries WHERE id = ?', checked.payload.inquiryId)
  if (!inquiry) return { ok: false, reason: 'not_found' }
  if (inquiry.email_verified_at) {
    return { ok: true, already: true, inquiryId: checked.payload.inquiryId, name: inquiry.from_name, company: inquiry.company_name ?? '', subject: inquiry.subject, email: checked.payload.email }
  }
  const at = Date.now()
  await db.prepare(`UPDATE inquiries SET email_verified_at = ?, status = 'processing', updated_at = ? WHERE id = ? AND email_verified_at IS NULL`).bind(at, at, checked.payload.inquiryId).run()
  await db.prepare(
    `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, detail) VALUES (?, ?, 'lead', 'email.verified', 'inquiry', ?, ?)`,
  ).bind(id('aud'), at, checked.payload.inquiryId, JSON.stringify({ at })).run()
  return { ok: true, already: false, inquiryId: checked.payload.inquiryId, name: inquiry.from_name, company: inquiry.company_name ?? '', subject: inquiry.subject, email: checked.payload.email }
}

export async function suppressContact(db: D1Like, env: WorkerEnv, tokenOrEmail: { token?: string; email?: string; phone?: string }, actor = 'lead'): Promise<{ ok: boolean; email?: string }> {
  const at = Date.now()
  let email = tokenOrEmail.email ? normalizeEmail(tokenOrEmail.email) : ''
  let inquiryId: string | null = null
  if (tokenOrEmail.token) {
    const checked = await verifyDeskToken(secretOf(env), tokenOrEmail.token)
    if (!checked.ok) return { ok: false }
    inquiryId = checked.payload.inquiryId
    email = normalizeEmail(checked.payload.email)
  }
  if (email) await rememberSuppression(db, 'email', email)
  const phone = tokenOrEmail.phone ? parseE164(tokenOrEmail.phone) : null
  if (phone) await rememberSuppression(db, 'phone', phone)
  if (email) {
    await db.prepare(`UPDATE inquiries SET suppressed_at = ?, updated_at = ? WHERE lower(from_email) = ?`).bind(at, at, email).run()
    if (!inquiryId) {
      const row = await one<{ id: string }>(db, 'SELECT id FROM inquiries WHERE lower(from_email) = ? ORDER BY created_at DESC LIMIT 1', email)
      inquiryId = row?.id ?? null
    }
  }
  await db.prepare(
    `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, detail) VALUES (?, ?, ?, 'contact.suppressed', 'suppression', ?, ?)`,
  ).bind(id('aud'), at, actor, email || phone || 'unknown', JSON.stringify({ email, phone })).run()
  return { ok: true, email }
}

export async function clearSuppression(db: D1Like, email: string, actor: string): Promise<{ ok: boolean }> {
  const value = normalizeEmail(email)
  const phone = parseE164(email)
  const at = Date.now()
  await db.prepare(`UPDATE suppressions SET cleared_at = ? WHERE kind = 'email' AND value = ? AND cleared_at IS NULL`).bind(at, value).run()
  if (phone) await db.prepare(`UPDATE suppressions SET cleared_at = ? WHERE kind = 'phone' AND value = ? AND cleared_at IS NULL`).bind(at, phone).run()
  await db.prepare(`UPDATE inquiries SET suppressed_at = NULL, updated_at = ? WHERE lower(from_email) = ?`).bind(at, value).run()
  await db.prepare(
    `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, detail) VALUES (?, ?, ?, 'contact.unsuppressed', 'suppression', ?, ?)`,
  ).bind(id('aud'), at, actor, value, JSON.stringify({ email: value })).run()
  return { ok: true }
}

export async function listSuppressions(db: D1Like): Promise<{ kind: string; value: string; createdAt: number }[]> {
  const rows = await db.prepare(`SELECT kind, value, created_at FROM suppressions WHERE cleared_at IS NULL ORDER BY created_at DESC LIMIT 50`).bind().all<{ kind: string; value: string; created_at: number }>()
  return rows.results.map((row) => ({ kind: row.kind, value: row.value, createdAt: row.created_at }))
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
    if (await isSuppressed(db, row.from_email)) continue
    if (!shouldDraftFollowUp({ verified: true, suppressed: false, sentAt: row.sent_at, now, days, alreadyDrafted: Boolean(existing) })) continue
    const run = await one<{ id: string }>(db, 'SELECT id FROM agent_runs WHERE inquiry_id = ? ORDER BY started_at DESC LIMIT 1', row.id)
    if (!run) continue
    const approvalId = id('apr')
    const body = await stopFooter(env, row.id, row.from_email, `Hello ${row.from_name.split(' ')[0] || 'there'},\n\nQuote ${row.number} is still open. Reply if you want it revised or booked.\n\nMeridian Facilities sales desk\nCedarhaven`)
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
  if (!inquiry) throw new Error('The inquiry for this callback was not found.')
  if (!Number(inquiry.email_verified_at)) throw new Error('The lead email is not verified.')
  if (await isSuppressed(db, String(inquiry.from_email), input.phone)) throw new Error('This lead is suppressed.')
  const since = Date.now() - 24 * 60 * 60 * 1000
  const numberCount = (await one<{ n: number }>(db, `SELECT count(*) AS n FROM outbound_calls WHERE phone = ? AND created_at > ?`, input.phone, since))?.n ?? 0
  const globalCount = (await one<{ n: number }>(db, `SELECT count(*) AS n FROM outbound_calls WHERE created_at > ?`, since))?.n ?? 0
  const at = env.now ?? new Date()
  const gate = callAllowed({
    enabled: true,
    suppressed: false,
    phone: input.phone,
    numberCount,
    ipCount: 0,
    globalCount,
    at,
    timeZone: String(inquiry.timezone || env.CALL_WINDOW_TZ || 'Asia/Kuala_Lumpur'),
  })
  if (!gate.ok) return { mode: 'browser', status: gate.reason }
  const mode = callbackMode({
    callsEnabled: env.OUTBOUND_CALLS_ENABLED === 'true',
    privateKey: env.VAPI_PRIVATE_KEY,
    phoneNumberId: env.VAPI_OUTBOUND_PHONE_NUMBER_ID,
  })
  const callId = id('ocall')
  if (gate.when.getTime() > at.getTime() + 60_000) {
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
  const link = callPageUrl(origin(env), token)
  const text = await stopFooter(env, input.inquiryId, String(inquiry.from_email), `Hello ${String(inquiry.from_name).split(' ')[0] || 'there'},\n\nTalk to the Meridian assistant about ${inquiry.subject}:\n${link}\n\nThe link expires in two days.\n\nMeridian Facilities sales desk\nCedarhaven`)
  const enabled = env.OUTBOUND_EMAIL_ENABLED === 'true' && Boolean(env.RESEND_API_KEY)
  const sender = chooseSender({ enabled, apiKey: env.RESEND_API_KEY, fetchImpl: fetch })
  const sent = await sender.send({ to: String(inquiry.from_email), from: fromAddress(env), subject: 'Talk to Meridian now', text, html: emailHtml(text) })
  await db.prepare(
    `INSERT INTO outbound_messages (id, approval_id, inquiry_id, quote_id, to_email, subject, body, provider_message_id, status, created_at, provider, error)
     VALUES (?, NULL, ?, NULL, ?, 'Talk to Meridian now', ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id('out'),
    input.inquiryId,
    inquiry.from_email,
    text,
    sent.ok ? sent.id : null,
    sent.ok ? (enabled ? 'sent' : 'sandbox') : 'failed',
    Date.now(),
    enabled ? 'resend' : 'sandbox',
    sent.ok ? null : sent.reason,
  ).run()
  await db.prepare(
    `INSERT INTO outbound_calls (id, inquiry_id, approval_id, phone, mode, status, vapi_call_id, scheduled_at, started_at, ended_at, summary, created_at)
     VALUES (?, ?, ?, ?, 'browser', 'link_sent', NULL, NULL, NULL, NULL, ?, ?)`,
  ).bind(callId, input.inquiryId, input.approvalId, gate.phone, link, Date.now()).run()
  return { mode: 'browser', status: 'link_sent' }
}
