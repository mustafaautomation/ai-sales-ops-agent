import { buildQuoteSendArgs } from '../../packages/core/src/quote-email'
import { computeQuote } from '../../packages/core/src/quote'
import { redactValue } from '../../packages/core/src/redact'
import type { D1BoundStatement, D1Like } from './d1'

/** Expected row counts after a successful demo seed (used by reset idempotency tests). */
export const DEMO_SEED_COUNTS = {
  inquiries: 4,
  agent_runs: 4,
  quotes: 2,
  quote_lines: 3,
  approvals: 4,
  agent_steps: 12,
  outbound_messages: 1,
  crm_companies: 1,
  crm_contacts: 1,
  crm_deals: 1,
  calls: 1,
  suppressions: 1,
  audit_log: 5,
} as const

function pushQuote(
  stmts: D1BoundStatement[],
  db: D1Like,
  input: { id: string; number: string; inquiryId: string; runId: string; company: string; contact: string; email: string; status: string; createdAt: number; validUntil: string; math: ReturnType<typeof computeQuote> },
): void {
  const math = input.math
  stmts.push(
    db.prepare(
      `INSERT INTO quotes (id, number, inquiry_id, run_id, company_name, contact_name, contact_email, discount_code, discount_bps, tax_bps, subtotal_cents, discount_cents, tax_cents, total_cents, currency, status, valid_until, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, NULL, ?)`,
    ).bind(
      input.id, input.number, input.inquiryId, input.runId, input.company, input.contact, input.email,
      math.discountCode, math.discountBps, math.taxBps, math.subtotalCents, math.discountCents, math.taxCents, math.totalCents,
      input.status, input.validUntil, input.createdAt,
    ),
  )
  for (const [position, line] of math.lines.entries()) {
    stmts.push(
      db.prepare(
        `INSERT INTO quote_lines (id, quote_id, sku, description, qty, unit_price_cents, line_total_cents, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(`qli_${input.id}_${position}`, input.id, line.sku, line.description, line.qty, line.unitPriceCents, line.lineTotalCents, position),
    )
  }
}

function pushStep(
  stmts: D1BoundStatement[],
  db: D1Like,
  input: {
    id: string
    runId: string
    index: number
    tool: string
    status: string
    args: unknown
    result: unknown
    approvalId?: string | null
    model?: string | null
    startedAt: number
    finishedAt: number
  },
): void {
  const argsJson = JSON.stringify(redactValue(input.args))
  const resultJson = input.result == null ? null : JSON.stringify(redactValue(input.result))
  stmts.push(
    db.prepare(
      `INSERT INTO agent_steps (id, run_id, step_index, kind, tool_name, status, args_json, result_json, redacted_args_json, redacted_result_json, approval_id, model, created_at, started_at, finished_at)
       VALUES (?, ?, ?, 'tool', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.id,
      input.runId,
      input.index,
      input.tool,
      input.status,
      JSON.stringify(input.args),
      input.result == null ? null : JSON.stringify(input.result),
      argsJson,
      resultJson,
      input.approvalId ?? null,
      input.model ?? 'fixture',
      input.finishedAt,
      input.startedAt,
      input.finishedAt,
    ),
  )
}

/** Fixture desk used by the nightly reset. No model calls. Returns bound statements for an atomic D1 batch. */
export function seedDemoDeskStatements(db: D1Like, at = Date.now()): D1BoundStatement[] {
  const stmts: D1BoundStatement[] = []
  const ago = (hours: number) => at - Math.round(hours * 60 * 60 * 1000)
  const STAMP = {
    inq_seed_pending: ago(3),
    inq_seed_review: ago(20),
    inq_seed_sent: ago(48),
    inq_seed_spam: ago(72),
    call_seed_lantern: ago(5),
  } as const
  const validUntil = new Date(at + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const pendingMath = computeQuote({
    lines: [{ sku: 'OFFICE-CLEAN', qty: 10_000 }, { sku: 'RESTROOM', qty: 4 }],
    discountCode: 'ANNUAL',
    taxBps: 825,
  })
  const sentMath = computeQuote({ lines: [{ sku: 'WINDOW', qty: 24 }], discountCode: null, taxBps: 825 })
  const inquiries = [
    ['inq_seed_pending', 'email', 'Priya Shah', 'priya.shah@north-wharf.example', 'North Wharf Logistics', 'Annual office quote', 'Please quote nightly cleaning for 10,000 sqft and 4 restrooms. We want an annual contract.', 'awaiting_approval', 'quote'],
    ['inq_seed_sent', 'email', 'Noor Haddad', 'noor.haddad@lantern-hall.example', 'Lantern Hall', 'Window quote', 'Please quote 24 windows.', 'resolved', 'quote'],
    ['inq_seed_spam', 'email', 'Promo Desk', 'promo@guest-post.example', null, 'Guest post', 'We offer SEO services and guest posts.', 'archived', 'spam'],
    ['inq_seed_review', 'web', 'Eden Cho', 'eden.cho@millrace.example', 'Millrace Clinic', 'Unreadable note', 'The model could not price this note.', 'awaiting_approval', 'quote'],
  ] as const
  for (const row of inquiries) {
    stmts.push(
      db.prepare(
        `INSERT INTO inquiries (id, source, external_id, from_name, from_email, company_name, subject, body, status, intent, injection_flag, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      ).bind(row[0], row[1], `seed:${row[0]}`, row[2], row[3], row[4], row[5], row[6], row[7], row[8], STAMP[row[0] as keyof typeof STAMP], STAMP[row[0] as keyof typeof STAMP]),
    )
  }
  const runs = [
    ['run_seed_pending', 'inq_seed_pending', 'awaiting_approval', null, 'Quote drafted. CRM write and quote email are waiting on an operator.'],
    ['run_seed_sent', 'inq_seed_sent', 'completed', 'completed', 'Quote MF-1102 was sent after approval.'],
    ['run_seed_spam', 'inq_seed_spam', 'completed', 'archived_spam', 'Marked as spam (seo services, guest post). No reply was drafted.'],
    ['run_seed_review', 'inq_seed_review', 'awaiting_approval', null, 'Waiting on a human review. No price was invented.'],
  ] as const
  for (const row of runs) {
    stmts.push(
      db.prepare(
        `INSERT INTO agent_runs (id, inquiry_id, status, provider, disposition, summary, error, started_at, finished_at)
         VALUES (?, ?, ?, 'fixture', ?, ?, NULL, ?, ?)`,
      ).bind(row[0], row[1], row[2], row[3], row[4], STAMP[row[1] as keyof typeof STAMP], row[2] === 'completed' ? STAMP[row[1] as keyof typeof STAMP] : null),
    )
  }
  pushQuote(stmts, db, {
    id: 'quo_seed_pending', number: 'MF-1101', inquiryId: 'inq_seed_pending', runId: 'run_seed_pending',
    company: 'North Wharf Logistics', contact: 'Priya Shah', email: 'priya.shah@north-wharf.example', status: 'draft', createdAt: STAMP.inq_seed_pending, validUntil, math: pendingMath,
  })
  pushQuote(stmts, db, {
    id: 'quo_seed_sent', number: 'MF-1102', inquiryId: 'inq_seed_sent', runId: 'run_seed_sent',
    company: 'Lantern Hall', contact: 'Noor Haddad', email: 'noor.haddad@lantern-hall.example', status: 'sent', createdAt: STAMP.inq_seed_sent, validUntil, math: sentMath,
  })
  const pendingInquiry = {
    fromName: 'Priya Shah',
    fromEmail: 'priya.shah@north-wharf.example',
    companyName: 'North Wharf Logistics',
    subject: 'Annual office quote',
    body: 'Please quote nightly cleaning for 10,000 sqft and 4 restrooms. We want an annual contract.',
  }
  const pendingEmail = buildQuoteSendArgs(
    pendingInquiry,
    { ...pendingMath, quoteId: 'quo_seed_pending', number: 'MF-1101', validUntil },
  )
  delete pendingEmail.opening
  delete pendingEmail.answers
  delete pendingEmail.closing
  const pendingSubject = String(pendingEmail.subject)
  const crm = JSON.stringify({
    companyName: 'North Wharf Logistics', contactName: 'Priya Shah', contactEmail: 'priya.shah@north-wharf.example',
    dealTitle: 'Annual office cleaning', stage: 'proposal', amountCents: pendingMath.totalCents,
    quoteId: 'quo_seed_pending', quoteNumber: 'MF-1101', inquiryId: 'inq_seed_pending',
  })
  const email = JSON.stringify(pendingEmail)
  stmts.push(
    db.prepare(
      `INSERT INTO approvals (id, run_id, tool_name, status, proposed_json, final_json, note, decided_by, created_at, decided_at)
       VALUES ('apr_seed_crm', 'run_seed_pending', 'crm_upsert', 'pending', ?, NULL, NULL, NULL, ?, NULL)`,
    ).bind(crm, STAMP.inq_seed_pending),
  )
  stmts.push(
    db.prepare(
      `INSERT INTO approvals (id, run_id, tool_name, status, proposed_json, final_json, note, decided_by, created_at, decided_at)
       VALUES ('apr_seed_email', 'run_seed_pending', 'send_email', 'pending', ?, NULL, NULL, NULL, ?, NULL)`,
    ).bind(email, STAMP.inq_seed_pending),
  )
  stmts.push(
    db.prepare(
      `INSERT INTO approvals (id, run_id, tool_name, status, proposed_json, final_json, note, decided_by, created_at, decided_at)
       VALUES ('apr_seed_review', 'run_seed_review', 'human_review', 'pending', ?, NULL, 'No price was invented.', NULL, ?, NULL)`,
    ).bind(JSON.stringify({ reason: 'The note could not be priced.', note: 'No price was invented.' }), STAMP.inq_seed_review),
  )
  const sentInquiry = {
    fromName: 'Noor Haddad',
    fromEmail: 'noor.haddad@lantern-hall.example',
    companyName: 'Lantern Hall',
    subject: 'Window quote',
    body: 'Please quote 24 windows.',
  }
  const sentEmail = buildQuoteSendArgs(
    sentInquiry,
    { ...sentMath, quoteId: 'quo_seed_sent', number: 'MF-1102', validUntil },
  )
  delete sentEmail.opening
  delete sentEmail.answers
  delete sentEmail.closing
  const sentSubject = String(sentEmail.subject)
  stmts.push(
    db.prepare(
      `INSERT INTO approvals (id, run_id, tool_name, status, proposed_json, final_json, note, decided_by, created_at, decided_at)
       VALUES ('apr_seed_sent', 'run_seed_sent', 'send_email', 'executed', ?, ?, NULL, 'operator', ?, ?)`,
    ).bind(
      JSON.stringify(sentEmail),
      JSON.stringify(sentEmail),
      STAMP.inq_seed_sent, STAMP.inq_seed_sent,
    ),
  )

  const t0 = STAMP.inq_seed_pending
  pushStep(stmts, db, {
    id: 'stp_seed_pending_classify', runId: 'run_seed_pending', index: 0, tool: 'classify', status: 'ok',
    args: { text: '[email redacted]' }, result: { intent: 'quote', injection: false, signals: ['nightly', 'sqft', 'restrooms', 'annual'] },
    model: 'fixture', startedAt: t0, finishedAt: t0 + 420,
  })
  pushStep(stmts, db, {
    id: 'stp_seed_pending_kb', runId: 'run_seed_pending', index: 1, tool: 'search_kb', status: 'ok',
    args: { query: 'annual office cleaning restrooms' }, result: { hits: [{ slug: 'services', title: 'Services' }] },
    model: 'fixture', startedAt: t0 + 500, finishedAt: t0 + 980,
  })
  pushStep(stmts, db, {
    id: 'stp_seed_pending_draft', runId: 'run_seed_pending', index: 2, tool: 'draft_quote', status: 'ok',
    args: { lines: [{ sku: 'OFFICE-CLEAN', qty: 10_000 }, { sku: 'RESTROOM', qty: 4 }], discountCode: 'ANNUAL' },
    result: { quoteId: 'quo_seed_pending', number: 'MF-1101', totalCents: pendingMath.totalCents },
    model: 'fixture', startedAt: t0 + 1_100, finishedAt: t0 + 1_850,
  })
  pushStep(stmts, db, {
    id: 'stp_seed_pending_crm', runId: 'run_seed_pending', index: 3, tool: 'crm_upsert', status: 'pending_approval',
    args: { companyName: 'North Wharf Logistics', stage: 'proposal' }, result: null,
    approvalId: 'apr_seed_crm', model: 'fixture', startedAt: t0 + 2_000, finishedAt: t0 + 2_120,
  })
  pushStep(stmts, db, {
    id: 'stp_seed_pending_email', runId: 'run_seed_pending', index: 4, tool: 'send_email', status: 'pending_approval',
    args: { to: '[email]', subject: pendingSubject, purpose: 'quote' }, result: null,
    approvalId: 'apr_seed_email', model: 'fixture', startedAt: t0 + 2_200, finishedAt: t0 + 2_350,
  })

  const ts = STAMP.inq_seed_sent
  pushStep(stmts, db, {
    id: 'stp_seed_sent_classify', runId: 'run_seed_sent', index: 0, tool: 'classify', status: 'ok',
    args: { text: '[email redacted]' }, result: { intent: 'quote', injection: false, signals: ['windows'] },
    model: 'fixture', startedAt: ts, finishedAt: ts + 380,
  })
  pushStep(stmts, db, {
    id: 'stp_seed_sent_kb', runId: 'run_seed_sent', index: 1, tool: 'search_kb', status: 'ok',
    args: { query: 'windows glass' }, result: { hits: [{ slug: 'services', title: 'Services' }] },
    model: 'fixture', startedAt: ts + 450, finishedAt: ts + 820,
  })
  pushStep(stmts, db, {
    id: 'stp_seed_sent_draft', runId: 'run_seed_sent', index: 2, tool: 'draft_quote', status: 'ok',
    args: { lines: [{ sku: 'WINDOW', qty: 24 }] }, result: { quoteId: 'quo_seed_sent', number: 'MF-1102', totalCents: sentMath.totalCents },
    model: 'fixture', startedAt: ts + 900, finishedAt: ts + 1_450,
  })
  pushStep(stmts, db, {
    id: 'stp_seed_sent_email', runId: 'run_seed_sent', index: 3, tool: 'send_email', status: 'ok',
    args: { to: '[email]', subject: sentSubject, purpose: 'quote' },
    result: { status: 'sandbox', provider: 'sandbox' },
    approvalId: 'apr_seed_sent', model: 'fixture', startedAt: ts + 1_600, finishedAt: ts + 2_100,
  })

  pushStep(stmts, db, {
    id: 'stp_seed_spam_classify', runId: 'run_seed_spam', index: 0, tool: 'classify', status: 'ok',
    args: { text: '[email redacted]' }, result: { intent: 'spam', injection: false, signals: ['seo', 'guest post'] },
    model: 'fixture', startedAt: STAMP.inq_seed_spam, finishedAt: STAMP.inq_seed_spam + 260,
  })
  pushStep(stmts, db, {
    id: 'stp_seed_review_classify', runId: 'run_seed_review', index: 0, tool: 'classify', status: 'ok',
    args: { text: '[email redacted]' }, result: { intent: 'quote', injection: false, signals: [] },
    model: 'fixture', startedAt: STAMP.inq_seed_review, finishedAt: STAMP.inq_seed_review + 310,
  })
  pushStep(stmts, db, {
    id: 'stp_seed_review_human', runId: 'run_seed_review', index: 1, tool: 'human_review', status: 'pending_approval',
    args: { reason: 'The note could not be priced.' }, result: null,
    approvalId: 'apr_seed_review', model: 'fixture', startedAt: STAMP.inq_seed_review + 400, finishedAt: STAMP.inq_seed_review + 480,
  })

  stmts.push(db.prepare(`UPDATE agent_runs SET finished_at = ? WHERE id = 'run_seed_sent'`).bind(ts + 2_100))
  stmts.push(db.prepare(`UPDATE agent_runs SET finished_at = ? WHERE id = 'run_seed_spam'`).bind(STAMP.inq_seed_spam + 260))

  stmts.push(
    db.prepare(
      `INSERT INTO outbound_messages (id, approval_id, inquiry_id, quote_id, to_email, subject, body, provider_message_id, status, created_at)
       VALUES ('out_seed_sent', 'apr_seed_sent', 'inq_seed_sent', 'quo_seed_sent', 'noor.haddad@lantern-hall.example', ?, ?, NULL, 'sandbox', ?)`,
    ).bind(sentSubject, String(sentEmail.body ?? ''), STAMP.inq_seed_sent),
  )
  stmts.push(
    db.prepare(
      `INSERT INTO crm_companies (id, external_id, name, domain, created_at, updated_at) VALUES ('co_seed_lantern', 'lantern-hall', 'Lantern Hall', 'lantern-hall.example', ?, ?)`,
    ).bind(STAMP.inq_seed_sent, STAMP.inq_seed_sent),
  )
  stmts.push(
    db.prepare(
      `INSERT INTO crm_contacts (id, company_id, name, email, created_at) VALUES ('ctc_seed_noor', 'co_seed_lantern', 'Noor Haddad', 'noor.haddad@lantern-hall.example', ?)`,
    ).bind(STAMP.inq_seed_sent),
  )
  stmts.push(
    db.prepare(
      `INSERT INTO crm_deals (id, company_id, external_id, title, stage, amount_cents, quote_id, inquiry_id, source, created_at, updated_at)
       VALUES ('deal_seed_lantern', 'co_seed_lantern', 'lantern-hall:windows', 'Window cleaning', 'proposal', ?, 'quo_seed_sent', 'inq_seed_sent', 'agent', ?, ?)`,
    ).bind(sentMath.totalCents, STAMP.inq_seed_sent, STAMP.inq_seed_sent),
  )
  stmts.push(
    db.prepare(
      `INSERT INTO calls (id, vapi_call_id, visitor_hash, from_number, caller_name, company_name, inquiry_id, status, summary, transcript, outcome, started_at, ended_at, created_at)
       VALUES ('call_seed_lantern', 'vapi_seed_lantern', NULL, NULL, 'Noor Haddad', 'Lantern Hall', 'inq_seed_sent', 'ended', 'Asked about 24 windows.', '"24 windows"', 'customer-ended-call', ?, ?, ?)`,
    ).bind(STAMP.call_seed_lantern - 4 * 60 * 1000, STAMP.call_seed_lantern, STAMP.call_seed_lantern),
  )

  // Seeded suppression so Settings reflects a suppression event.
  stmts.push(
    db.prepare(
      `INSERT INTO suppressions (id, kind, value, created_at, cleared_at) VALUES ('sup_seed_promo', 'email', 'promo@guest-post.example', ?, NULL)`,
    ).bind(STAMP.inq_seed_spam),
  )
  stmts.push(
    db.prepare(
      `UPDATE inquiries SET suppressed_at = ?, updated_at = ? WHERE id = 'inq_seed_spam'`,
    ).bind(STAMP.inq_seed_spam, STAMP.inq_seed_spam),
  )

  const audit = [
    ['aud_seed_spam', STAMP.inq_seed_spam, 'agent', 'inquiry.classified', 'inquiry', 'inq_seed_spam', '{"intent":"spam"}'],
    ['aud_seed_suppress', STAMP.inq_seed_spam, 'agent', 'contact.suppressed', 'suppression', 'p***@guest-post.example', '{"email":"p***@guest-post.example"}'],
    ['aud_seed_sent', STAMP.inq_seed_sent, 'operator', 'approval.approved', 'approval', 'apr_seed_sent', '{"tool":"send_email","sandbox":true}'],
    ['aud_seed_pending', STAMP.inq_seed_pending, 'agent', 'approval.requested', 'approval', 'apr_seed_email', '{"tool":"send_email"}'],
    ['aud_seed_review', STAMP.inq_seed_review, 'agent', 'approval.requested', 'approval', 'apr_seed_review', '{"tool":"human_review"}'],
  ] as const
  for (const row of audit) {
    stmts.push(
      db.prepare(
        `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(row[0], row[1], row[2], row[3], row[4], row[5], row[6]),
    )
  }
  stmts.push(db.prepare(`INSERT INTO settings (key, value) VALUES ('quote_seq', '1102') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind())
  return stmts
}

/** Runs the demo seed immediately (non-batched). Prefer resetDemo for production resets. */
export async function seedDemoDesk(db: D1Like, at = Date.now()): Promise<void> {
  for (const statement of seedDemoDeskStatements(db, at)) {
    await statement.run()
  }
}
