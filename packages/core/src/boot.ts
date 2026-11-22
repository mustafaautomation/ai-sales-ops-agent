import { eq } from 'drizzle-orm'
import { migrate } from './migrate'
import { openDatabase, type DB } from './db'
import { id, slug } from './ids'
import { httpPorts, type Ports } from './ports'
import { createProvider } from './providers'
import { logLine } from './redact'
import { releaseRun, syncInbox } from './run'
import { crmCompanies, crmContacts, crmDeals } from './schema'
import { getInquiryByExternal, getSetting, listRunsForInquiry, now, seedReference, setSetting } from './store'

const DEMO_COMPLETE = ['e_north', 'e_brightline', 'e_west', 'e_pike']

export function databasePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.DATABASE_PATH || './data/meridian.db'
}

export async function waitForUrl(url: string, attempts = 60): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (response.ok) return
    } catch {
      // Service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function syncCrm(db: DB, ports: Ports): Promise<void> {
  const records = await ports.crm.lookup('')
  for (const record of records) {
    if (!record.externalKey || !record.companyName || !record.dealTitle) continue
    const existing = db.select().from(crmDeals).where(eq(crmDeals.externalId, record.externalKey)).get()
    if (existing) continue
    const at = now()
    const companyExternal = slug(record.companyName)
    let company = db.select().from(crmCompanies).where(eq(crmCompanies.externalId, companyExternal)).get()
    if (!company) {
      const created = {
        id: id('co'),
        externalId: companyExternal,
        name: record.companyName,
        domain: record.domain,
        createdAt: at,
        updatedAt: at,
      }
      db.insert(crmCompanies).values(created).run()
      company = created
    }
    if (record.contactEmail) {
      const contacts = db.select().from(crmContacts).where(eq(crmContacts.companyId, company.id)).all()
      if (!contacts.some((contact) => contact.email.toLowerCase() === record.contactEmail!.toLowerCase())) {
        db.insert(crmContacts)
          .values({
            id: id('ctc'),
            companyId: company.id,
            name: record.contactName,
            email: record.contactEmail,
            createdAt: at,
          })
          .run()
      }
    }
    db.insert(crmDeals)
      .values({
        id: id('deal'),
        companyId: company.id,
        externalId: record.externalKey,
        title: record.dealTitle,
        stage: record.stage || 'lead',
        amountCents: record.amountCents ?? 0,
        quoteId: null,
        inquiryId: null,
        source: 'crm',
        createdAt: at,
        updatedAt: at,
      })
      .run()
  }
}

async function progressDemo(db: DB, ports: Ports): Promise<void> {
  if (getSetting(db, 'demo_progress') === 'done') return
  const provider = createProvider()
  for (const externalId of DEMO_COMPLETE) {
    const inquiry = getInquiryByExternal(db, externalId)
    if (!inquiry) continue
    const run = listRunsForInquiry(db, inquiry.id)[0]
    if (!run) continue
    await releaseRun(db, ports, run.id, 'seed', provider)
  }
  backdateDemo(db)
  setSetting(db, 'demo_progress', 'done')
  logLine('demo queue progressed')
}

/** Hours ago for each seeded inquiry, newest first, so the demo desk reads like a few days of mail. */
const DEMO_AGE_HOURS = [0.4, 1.3, 2.6, 4.5, 7, 19, 23, 28, 44, 50, 68, 75]

/**
 * The fixture inbox is imported in one pass, so every seeded row would carry
 * the boot timestamp. Shift each seeded inquiry, and everything hanging off
 * it, back by a fixed offset. Runs once, before demo_progress is marked done.
 */
export function backdateDemo(db: DB): void {
  const raw = db.$client
  const rows = raw.prepare('SELECT id FROM inquiries ORDER BY created_at DESC, rowid DESC').all() as { id: string }[]
  const shift = raw.transaction(() => {
    rows.forEach((row, index) => {
      const hours = DEMO_AGE_HOURS[index] ?? DEMO_AGE_HOURS[DEMO_AGE_HOURS.length - 1] + (index - DEMO_AGE_HOURS.length + 1) * 9
      const ms = Math.round(hours * 60 * 60 * 1000)
      const runIds = (raw.prepare('SELECT id FROM agent_runs WHERE inquiry_id = ?').all(row.id) as { id: string }[]).map((run) => run.id)
      const approvalIds = runIds.flatMap((runId) => (raw.prepare('SELECT id FROM approvals WHERE run_id = ?').all(runId) as { id: string }[]).map((approval) => approval.id))
      raw.prepare('UPDATE inquiries SET created_at = created_at - ?, updated_at = updated_at - ? WHERE id = ?').run(ms, ms, row.id)
      raw.prepare('UPDATE quotes SET created_at = created_at - ? WHERE inquiry_id = ?').run(ms, row.id)
      raw.prepare('UPDATE crm_deals SET created_at = created_at - ?, updated_at = updated_at - ? WHERE inquiry_id = ?').run(ms, ms, row.id)
      raw.prepare('UPDATE outbound_messages SET created_at = created_at - ? WHERE inquiry_id = ?').run(ms, row.id)
      for (const runId of runIds) {
        raw.prepare('UPDATE agent_runs SET started_at = started_at - ?, finished_at = finished_at - ? WHERE id = ?').run(ms, ms, runId)
        raw.prepare('UPDATE agent_steps SET created_at = created_at - ?, started_at = started_at - ?, finished_at = finished_at - ? WHERE run_id = ?').run(ms, ms, ms, runId)
        raw.prepare('UPDATE approvals SET created_at = created_at - ?, decided_at = decided_at - ? WHERE run_id = ?').run(ms, ms, runId)
      }
      for (const entityId of [row.id, ...runIds, ...approvalIds]) {
        raw.prepare('UPDATE audit_log SET at = at - ? WHERE entity_id = ?').run(ms, entityId)
      }
    })
  })
  shift()
}

export async function bootDesk(env: NodeJS.ProcessEnv = process.env): Promise<DB> {
  const db = openDatabase(databasePath(env))
  migrate(db)
  seedReference(db)
  const emailBaseUrl = env.EMAIL_API_URL || 'http://127.0.0.1:4001'
  const crmBaseUrl = env.CRM_API_URL || 'http://127.0.0.1:4002'
  await waitForUrl(`${emailBaseUrl.replace(/\/$/, '')}/health`)
  await waitForUrl(`${crmBaseUrl.replace(/\/$/, '')}/health`)
  const ports = httpPorts({ emailBaseUrl, crmBaseUrl })
  await syncCrm(db, ports)
  const imported = await syncInbox(db, ports)
  await progressDemo(db, ports)
  logLine('desk booted', { imported })
  return db
}

export function prepareDatabase(env: NodeJS.ProcessEnv = process.env): DB {
  const db = openDatabase(databasePath(env))
  migrate(db)
  seedReference(db)
  return db
}
