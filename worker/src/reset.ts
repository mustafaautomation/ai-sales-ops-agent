import type { D1BoundStatement, D1Like } from './d1'
import { DEMO_SEED_COUNTS, seedDemoDeskStatements } from './demo-seed'
import { seedReference } from './desk'

export const DEMO_RESET_TABLES = [
  'outbound_messages',
  'agent_steps',
  'approvals',
  'quote_lines',
  'quotes',
  'calls',
  'crm_deals',
  'crm_contacts',
  'crm_companies',
  'audit_log',
  'agent_runs',
  'inquiries',
  'idempotency_keys',
  'suppressions',
] as const

/** Seed-row deletes for tables that can survive a selective wipe (fixed seed ids). Child tables first. */
export const DEMO_SEED_ROW_DELETES = [
  `DELETE FROM outbound_messages WHERE id LIKE 'out_seed_%'`,
  `DELETE FROM agent_steps WHERE id LIKE 'stp_seed_%'`,
  `DELETE FROM approvals WHERE id LIKE 'apr_seed_%'`,
  `DELETE FROM quote_lines WHERE quote_id LIKE 'quo_seed_%'`,
  `DELETE FROM quotes WHERE id LIKE 'quo_seed_%'`,
  `DELETE FROM calls WHERE id LIKE 'call_seed_%'`,
  `DELETE FROM crm_deals WHERE id LIKE 'deal_seed_%'`,
  `DELETE FROM crm_contacts WHERE id LIKE 'ctc_seed_%'`,
  `DELETE FROM crm_companies WHERE id LIKE 'co_seed_%'`,
  `DELETE FROM audit_log WHERE id LIKE 'aud_seed_%'`,
  `DELETE FROM agent_runs WHERE id LIKE 'run_seed_%'`,
  `DELETE FROM inquiries WHERE id LIKE 'inq_seed_%'`,
  `DELETE FROM suppressions WHERE id LIKE 'sup_seed_%'`,
] as const

export { DEMO_SEED_COUNTS }

function stmt(db: D1Like, sql: string, ...values: unknown[]): D1BoundStatement {
  return db.prepare(sql).bind(...values)
}

export async function resetDemo(db: D1Like): Promise<void> {
  const kept = await db.prepare(`SELECT id FROM inquiries WHERE email_verified_at IS NOT NULL`).bind().all<{ id: string }>()
  const ids = kept.results.map((row) => row.id)
  const statements: D1BoundStatement[] = []

  if (ids.length === 0) {
    for (const table of DEMO_RESET_TABLES) statements.push(stmt(db, `DELETE FROM ${table}`))
    statements.push(stmt(db, 'DELETE FROM outbound_calls'))
  } else {
    const marks = ids.map(() => '?').join(',')
    statements.push(stmt(db, `DELETE FROM outbound_messages WHERE inquiry_id IS NULL OR inquiry_id NOT IN (${marks})`, ...ids))
    statements.push(stmt(db, `DELETE FROM outbound_calls WHERE inquiry_id IS NULL OR inquiry_id NOT IN (${marks})`, ...ids))
    statements.push(stmt(db, `DELETE FROM quote_lines WHERE quote_id IN (SELECT id FROM quotes WHERE inquiry_id IS NULL OR inquiry_id NOT IN (${marks}))`, ...ids))
    statements.push(stmt(db, `DELETE FROM quotes WHERE inquiry_id IS NULL OR inquiry_id NOT IN (${marks})`, ...ids))
    statements.push(stmt(db, `DELETE FROM calls WHERE inquiry_id IS NULL OR inquiry_id NOT IN (${marks})`, ...ids))
    statements.push(stmt(db, `DELETE FROM crm_deals WHERE inquiry_id IS NULL OR inquiry_id NOT IN (${marks})`, ...ids))
    statements.push(stmt(db, `DELETE FROM approvals WHERE run_id IN (SELECT id FROM agent_runs WHERE inquiry_id NOT IN (${marks}))`, ...ids))
    statements.push(stmt(db, `DELETE FROM agent_steps WHERE run_id IN (SELECT id FROM agent_runs WHERE inquiry_id NOT IN (${marks}))`, ...ids))
    statements.push(stmt(db, `DELETE FROM agent_runs WHERE inquiry_id NOT IN (${marks})`, ...ids))
    statements.push(stmt(db, `DELETE FROM inquiries WHERE id NOT IN (${marks})`, ...ids))
    statements.push(stmt(db, 'DELETE FROM idempotency_keys'))
  }

  statements.push(stmt(db, 'DELETE FROM daily_counters'))
  for (const sql of DEMO_SEED_ROW_DELETES) statements.push(stmt(db, sql))
  statements.push(...seedDemoDeskStatements(db))

  await seedReference(db)
  await db.batch(statements)
}

type LimiterBinding = {
  idFromName(name: string): unknown
  get(id: unknown): { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> }
}

/** Operator reset also drops the call limiter. The nightly cron only calls resetDemo. */
export async function resetDemoAndLimits(db: D1Like, limiter?: LimiterBinding): Promise<void> {
  await resetDemo(db)
  if (!limiter) return
  const stub = limiter.get(limiter.idFromName('calls'))
  await stub.fetch('https://limiter/reset', { method: 'POST', body: '{}' })
}
