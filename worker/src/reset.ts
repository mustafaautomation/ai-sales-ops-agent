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
  for (const table of DEMO_RESET_TABLES) {
    await db.prepare(`DELETE FROM ${table}`).bind().run()
  }
  await seedReference(db)
  await seedDemoDesk(db)
}
