import { computeQuote } from '../../packages/core/src/quote'
import type { D1Like } from './d1'

async function insertQuote(
  db: D1Like,
  input: { id: string; number: string; inquiryId: string; runId: string; company: string; contact: string; email: string; status: string; createdAt: number; validUntil: string; math: ReturnType<typeof computeQuote> },
): Promise<void> {
  const math = input.math
  await db.prepare(
    `INSERT INTO quotes (id, number, inquiry_id, run_id, company_name, contact_name, contact_email, discount_code, discount_bps, tax_bps, subtotal_cents, discount_cents, tax_cents, total_cents, currency, status, valid_until, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, NULL, ?)`,
  ).bind(
    input.id, input.number, input.inquiryId, input.runId, input.company, input.contact, input.email,
    math.discountCode, math.discountBps, math.taxBps, math.subtotalCents, math.discountCents, math.taxCents, math.totalCents,
    input.status, input.validUntil, input.createdAt,
  ).run()
  for (const [position, line] of math.lines.entries()) {
    await db.prepare(
      `INSERT INTO quote_lines (id, quote_id, sku, description, qty, unit_price_cents, line_total_cents, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(`qli_${input.id}_${position}`, input.id, line.sku, line.description, line.qty, line.unitPriceCents, line.lineTotalCents, position).run()
  }
}

/** Fixture desk used by the nightly reset. No model calls. */
export async function seedDemoDesk(db: D1Like, at = Date.now()): Promise<void> {
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
    await db.prepare(
      `INSERT INTO inquiries (id, source, external_id, from_name, from_email, company_name, subject, body, status, intent, injection_flag, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).bind(row[0], row[1], `seed:${row[0]}`, row[2], row[3], row[4], row[5], row[6], row[7], row[8], STAMP[row[0] as keyof typeof STAMP], STAMP[row[0] as keyof typeof STAMP]).run()
  }
  const runs = [
    ['run_seed_pending', 'inq_seed_pending', 'awaiting_approval', null, 'Quote drafted. CRM write and quote email are waiting on an operator.'],
    ['run_seed_sent', 'inq_seed_sent', 'completed', 'completed', 'Quote MF-1102 was sent after approval.'],
    ['run_seed_spam', 'inq_seed_spam', 'completed', 'archived_spam', 'Marked as spam (seo services, guest post). No reply was drafted.'],
    ['run_seed_review', 'inq_seed_review', 'awaiting_approval', null, 'Waiting on a human review. No price was invented.'],
  ] as const
  for (const row of runs) {
    await db.prepare(
      `INSERT INTO agent_runs (id, inquiry_id, status, provider, disposition, summary, error, started_at, finished_at)
       VALUES (?, ?, ?, 'fixture', ?, ?, NULL, ?, ?)`,
    ).bind(row[0], row[1], row[2], row[3], row[4], STAMP[row[1] as keyof typeof STAMP], row[2] === 'completed' ? STAMP[row[1] as keyof typeof STAMP] : null).run()
  }
  await insertQuote(db, {
    id: 'quo_seed_pending', number: 'MF-1101', inquiryId: 'inq_seed_pending', runId: 'run_seed_pending',
    company: 'North Wharf Logistics', contact: 'Priya Shah', email: 'priya.shah@north-wharf.example', status: 'draft', createdAt: STAMP.inq_seed_pending, validUntil, math: pendingMath,
  })
  await insertQuote(db, {
    id: 'quo_seed_sent', number: 'MF-1102', inquiryId: 'inq_seed_sent', runId: 'run_seed_sent',
    company: 'Lantern Hall', contact: 'Noor Haddad', email: 'noor.haddad@lantern-hall.example', status: 'sent', createdAt: STAMP.inq_seed_sent, validUntil, math: sentMath,
  })
  const crm = JSON.stringify({
    companyName: 'North Wharf Logistics', contactName: 'Priya Shah', contactEmail: 'priya.shah@north-wharf.example',
    dealTitle: pendingMath.lines[0]?.description ?? 'Office cleaning', stage: 'proposal', amountCents: pendingMath.totalCents,
    quoteId: 'quo_seed_pending', quoteNumber: 'MF-1101', inquiryId: 'inq_seed_pending',
  })
  const email = JSON.stringify({
    to: 'priya.shah@north-wharf.example', subject: 'Quote MF-1101 — North Wharf Logistics',
    body: `Quote MF-1101 total ${(pendingMath.totalCents / 100).toFixed(2)} USD.`, purpose: 'quote', quoteId: 'quo_seed_pending',
  })
  await db.prepare(
    `INSERT INTO approvals (id, run_id, tool_name, status, proposed_json, final_json, note, decided_by, created_at, decided_at)
     VALUES ('apr_seed_crm', 'run_seed_pending', 'crm_upsert', 'pending', ?, NULL, NULL, NULL, ?, NULL)`,
  ).bind(crm, STAMP.inq_seed_pending).run()
  await db.prepare(
    `INSERT INTO approvals (id, run_id, tool_name, status, proposed_json, final_json, note, decided_by, created_at, decided_at)
     VALUES ('apr_seed_email', 'run_seed_pending', 'send_email', 'pending', ?, NULL, NULL, NULL, ?, NULL)`,
  ).bind(email, STAMP.inq_seed_pending).run()
  await db.prepare(
    `INSERT INTO approvals (id, run_id, tool_name, status, proposed_json, final_json, note, decided_by, created_at, decided_at)
     VALUES ('apr_seed_review', 'run_seed_review', 'human_review', 'pending', ?, NULL, 'No price was invented.', NULL, ?, NULL)`,
  ).bind(JSON.stringify({ reason: 'The note could not be priced.', note: 'No price was invented.' }), STAMP.inq_seed_review).run()
  await db.prepare(
    `INSERT INTO approvals (id, run_id, tool_name, status, proposed_json, final_json, note, decided_by, created_at, decided_at)
     VALUES ('apr_seed_sent', 'run_seed_sent', 'send_email', 'executed', ?, ?, NULL, 'operator', ?, ?)`,
  ).bind(
    JSON.stringify({ to: 'noor.haddad@lantern-hall.example', subject: 'Quote MF-1102', body: 'Window quote.', purpose: 'quote', quoteId: 'quo_seed_sent' }),
    JSON.stringify({ to: 'noor.haddad@lantern-hall.example', subject: 'Quote MF-1102', body: 'Window quote.', purpose: 'quote', quoteId: 'quo_seed_sent' }),
    STAMP.inq_seed_sent, STAMP.inq_seed_sent,
  ).run()
  await db.prepare(
    `INSERT INTO outbound_messages (id, approval_id, inquiry_id, quote_id, to_email, subject, body, provider_message_id, status, created_at)
     VALUES ('out_seed_sent', 'apr_seed_sent', 'inq_seed_sent', 'quo_seed_sent', 'noor.haddad@lantern-hall.example', 'Quote MF-1102', 'Window quote.', NULL, 'sandbox', ?)`,
  ).bind(STAMP.inq_seed_sent).run()
  await db.prepare(
    `INSERT INTO crm_companies (id, external_id, name, domain, created_at, updated_at) VALUES ('co_seed_lantern', 'lantern-hall', 'Lantern Hall', 'lantern-hall.example', ?, ?)`,
  ).bind(STAMP.inq_seed_sent, STAMP.inq_seed_sent).run()
  await db.prepare(
    `INSERT INTO crm_contacts (id, company_id, name, email, created_at) VALUES ('ctc_seed_noor', 'co_seed_lantern', 'Noor Haddad', 'noor.haddad@lantern-hall.example', ?)`,
  ).bind(STAMP.inq_seed_sent).run()
  await db.prepare(
    `INSERT INTO crm_deals (id, company_id, external_id, title, stage, amount_cents, quote_id, inquiry_id, source, created_at, updated_at)
     VALUES ('deal_seed_lantern', 'co_seed_lantern', 'lantern-hall:windows', 'Window cleaning', 'proposal', ?, 'quo_seed_sent', 'inq_seed_sent', 'agent', ?, ?)`,
  ).bind(sentMath.totalCents, STAMP.inq_seed_sent, STAMP.inq_seed_sent).run()
  await db.prepare(
    `INSERT INTO calls (id, vapi_call_id, visitor_hash, from_number, caller_name, company_name, inquiry_id, status, summary, transcript, outcome, started_at, ended_at, created_at)
     VALUES ('call_seed_lantern', 'vapi_seed_lantern', NULL, NULL, 'Noor Haddad', 'Lantern Hall', 'inq_seed_sent', 'ended', 'Asked about 24 windows.', '"24 windows"', 'customer-ended-call', ?, ?, ?)`,
  ).bind(STAMP.call_seed_lantern, STAMP.call_seed_lantern, STAMP.call_seed_lantern).run()
  const audit = [
    ['aud_seed_spam', 'agent', 'inquiry.classified', 'inquiry', 'inq_seed_spam', '{"intent":"spam"}'],
    ['aud_seed_sent', 'operator', 'approval.approved', 'approval', 'apr_seed_sent', '{"tool":"send_email","sandbox":true}'],
    ['aud_seed_pending', 'agent', 'approval.requested', 'approval', 'apr_seed_email', '{"tool":"send_email"}'],
  ] as const
  for (const row of audit) {
    await db.prepare(
      `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(row[0], STAMP.inq_seed_sent, row[1], row[2], row[3], row[4], row[5]).run()
  }
  await db.prepare(`INSERT INTO settings (key, value) VALUES ('quote_seq', '1102') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind().run()
}
