import type { D1Like } from './d1'
import { seedDemoDesk } from './demo-seed'
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
] as const

export async function resetDemo(db: D1Like): Promise<void> {
  const kept = await db.prepare(`SELECT id FROM inquiries WHERE email_verified_at IS NOT NULL`).bind().all<{ id: string }>()
  const ids = kept.results.map((row) => row.id)
  if (ids.length === 0) {
    for (const table of DEMO_RESET_TABLES) await db.prepare(`DELETE FROM ${table}`).bind().run()
    await db.prepare('DELETE FROM outbound_calls').bind().run()
  } else {
    const marks = ids.map(() => '?').join(',')
    await db.prepare(`DELETE FROM outbound_messages WHERE inquiry_id IS NULL OR inquiry_id NOT IN (${marks})`).bind(...ids).run()
    await db.prepare(`DELETE FROM outbound_calls WHERE inquiry_id IS NULL OR inquiry_id NOT IN (${marks})`).bind(...ids).run()
    await db.prepare(`DELETE FROM quote_lines WHERE quote_id IN (SELECT id FROM quotes WHERE inquiry_id IS NULL OR inquiry_id NOT IN (${marks}))`).bind(...ids).run()
    await db.prepare(`DELETE FROM quotes WHERE inquiry_id IS NULL OR inquiry_id NOT IN (${marks})`).bind(...ids).run()
    await db.prepare(`DELETE FROM calls WHERE inquiry_id IS NULL OR inquiry_id NOT IN (${marks})`).bind(...ids).run()
    await db.prepare(`DELETE FROM crm_deals WHERE inquiry_id IS NULL OR inquiry_id NOT IN (${marks})`).bind(...ids).run()
    await db.prepare(`DELETE FROM approvals WHERE run_id IN (SELECT id FROM agent_runs WHERE inquiry_id NOT IN (${marks}))`).bind(...ids).run()
    await db.prepare(`DELETE FROM agent_steps WHERE run_id IN (SELECT id FROM agent_runs WHERE inquiry_id NOT IN (${marks}))`).bind(...ids).run()
    await db.prepare(`DELETE FROM agent_runs WHERE inquiry_id NOT IN (${marks})`).bind(...ids).run()
    await db.prepare(`DELETE FROM inquiries WHERE id NOT IN (${marks})`).bind(...ids).run()
    await db.prepare('DELETE FROM idempotency_keys').bind().run()
  }
  await seedReference(db)
  await seedDemoDesk(db)
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
