import { and, desc, eq, sql } from 'drizzle-orm'
import { hashPassword, OPERATOR } from './auth'
import type { DB } from './db'
import { id } from './ids'
import { chunkDocument, KB_DOCS, type KbChunk } from './kb'
import { redactValue } from './redact'
import {
  calls,
  agentRuns,
  agentSteps,
  approvals,
  auditLog,
  crmCompanies,
  crmContacts,
  crmDeals,
  idempotencyKeys,
  inquiries,
  kbChunks,
  kbDocuments,
  outboundMessages,
  quoteLines,
  quotes,
  rateBuckets,
  sessions,
  settings,
  users,
} from './schema'

export function now(): number {
  return Date.now()
}

export function getSetting(db: DB, key: string): string | null {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null
}

export function setSetting(db: DB, key: string, value: string): void {
  const existing = getSetting(db, key)
  if (existing == null) db.insert(settings).values({ key, value }).run()
  else db.update(settings).set({ value }).where(eq(settings.key, key)).run()
}

export function ensureSetting(db: DB, key: string, value: string): void {
  if (getSetting(db, key) == null) setSetting(db, key, value)
}

export function numberSetting(db: DB, key: string, fallback: number): number {
  const raw = getSetting(db, key)
  const parsed = raw == null ? NaN : Number(raw)
  return Number.isInteger(parsed) ? parsed : fallback
}

export function seedReference(db: DB, at = now()): void {
  const existing = db.select().from(users).where(eq(users.email, OPERATOR.email)).get()
  if (!existing) {
    db.insert(users)
      .values({
        id: OPERATOR.id,
        email: OPERATOR.email,
        name: OPERATOR.name,
        passwordHash: hashPassword(OPERATOR.password),
        createdAt: at,
      })
      .run()
  }
  ensureSetting(db, 'tax_bps', '825')
  ensureSetting(db, 'quote_valid_days', '14')
  ensureSetting(db, 'quote_seq', '1000')
  db.delete(kbChunks).run()
  db.delete(kbDocuments).run()
  for (const doc of KB_DOCS) {
    const documentId = `kb_${doc.slug}`
    db.insert(kbDocuments)
      .values({ id: documentId, slug: doc.slug, title: doc.title, body: doc.body, updatedAt: at })
      .run()
    for (const chunk of chunkDocument(doc)) {
      db.insert(kbChunks)
        .values({
          id: id('chk'),
          documentId,
          slug: chunk.slug,
          title: chunk.title,
          ordinal: chunk.ordinal,
          heading: chunk.heading,
          content: chunk.content,
        })
        .run()
    }
  }
}

export function writeAudit(
  db: DB,
  entry: { actor: string; action: string; entityType: string; entityId: string; detail: unknown },
): void {
  db.insert(auditLog)
    .values({
      id: id('aud'),
      at: now(),
      actor: entry.actor,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      detail: JSON.stringify(redactValue(entry.detail)),
    })
    .run()
}

export function readIdempotent<T>(db: DB, key: string): T | null {
  const row = db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key)).get()
  if (!row) return null
  return JSON.parse(row.responseJson) as T
}

export function writeIdempotent(db: DB, key: string, scope: string, response: unknown): void {
  const existing = db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key)).get()
  if (existing) return
  db.insert(idempotencyKeys)
    .values({ key, scope, responseJson: JSON.stringify(response), createdAt: now() })
    .run()
}

export function hitRateLimit(
  db: DB,
  key: string,
  limit: number,
  windowMs: number,
  at = now(),
): { ok: boolean; remaining: number } {
  const row = db.select().from(rateBuckets).where(eq(rateBuckets.bucketKey, key)).get()
  if (!row || at - row.windowStart >= windowMs) {
    if (!row) db.insert(rateBuckets).values({ bucketKey: key, windowStart: at, count: 1 }).run()
    else db.update(rateBuckets).set({ windowStart: at, count: 1 }).where(eq(rateBuckets.bucketKey, key)).run()
    return { ok: true, remaining: Math.max(0, limit - 1) }
  }
  if (row.count >= limit) return { ok: false, remaining: 0 }
  const count = row.count + 1
  db.update(rateBuckets).set({ count }).where(eq(rateBuckets.bucketKey, key)).run()
  return { ok: true, remaining: Math.max(0, limit - count) }
}

export function nextQuoteNumber(db: DB): string {
  const current = Number(getSetting(db, 'quote_seq') ?? '1000')
  const next = Number.isInteger(current) ? current + 1 : 1001
  setSetting(db, 'quote_seq', String(next))
  return `MF-${next}`
}

export function listInquiries(db: DB) {
  return db.select().from(inquiries).orderBy(desc(inquiries.createdAt)).all()
}

export function getInquiry(db: DB, inquiryId: string) {
  return db.select().from(inquiries).where(eq(inquiries.id, inquiryId)).get() ?? null
}

export function getInquiryByExternal(db: DB, externalId: string) {
  return db.select().from(inquiries).where(eq(inquiries.externalId, externalId)).get() ?? null
}

export function listRunsForInquiry(db: DB, inquiryId: string) {
  return db.select().from(agentRuns).where(eq(agentRuns.inquiryId, inquiryId)).orderBy(desc(agentRuns.startedAt)).all()
}

export function getRun(db: DB, runId: string) {
  return db.select().from(agentRuns).where(eq(agentRuns.id, runId)).get() ?? null
}

export function listSteps(db: DB, runId: string) {
  return db.select().from(agentSteps).where(eq(agentSteps.runId, runId)).orderBy(agentSteps.stepIndex).all()
}

export function getApproval(db: DB, approvalId: string) {
  return db.select().from(approvals).where(eq(approvals.id, approvalId)).get() ?? null
}

export function listApprovals(db: DB) {
  return db.select().from(approvals).orderBy(desc(approvals.createdAt)).all()
}

export function pendingApprovalForRun(db: DB, runId: string) {
  return (
    db
      .select()
      .from(approvals)
      .where(and(eq(approvals.runId, runId), eq(approvals.status, 'pending')))
      .get() ?? null
  )
}

export function listQuotes(db: DB) {
  return db.select().from(quotes).orderBy(desc(quotes.createdAt)).all()
}

export function getQuote(db: DB, quoteId: string) {
  const quote = db.select().from(quotes).where(eq(quotes.id, quoteId)).get()
  if (!quote) return null
  const lines = db.select().from(quoteLines).where(eq(quoteLines.quoteId, quoteId)).orderBy(quoteLines.position).all()
  return { quote, lines }
}

export function listDeals(db: DB) {
  return db.select().from(crmDeals).orderBy(desc(crmDeals.updatedAt)).all()
}

export function listCompanies(db: DB) {
  return db.select().from(crmCompanies).orderBy(crmCompanies.name).all()
}

export function listContacts(db: DB) {
  return db.select().from(crmContacts).all()
}

export function listDocuments(db: DB) {
  return db.select().from(kbDocuments).orderBy(kbDocuments.title).all()
}

export function getDocumentBySlug(db: DB, slug: string) {
  const doc = db.select().from(kbDocuments).where(eq(kbDocuments.slug, slug)).get()
  if (!doc) return null
  const chunks = db.select().from(kbChunks).where(eq(kbChunks.documentId, doc.id)).orderBy(kbChunks.ordinal).all()
  return { doc, chunks }
}

export function loadChunks(db: DB): KbChunk[] {
  return db
    .select()
    .from(kbChunks)
    .all()
    .map((chunk) => ({
      slug: chunk.slug,
      title: chunk.title,
      heading: chunk.heading,
      content: chunk.content,
      ordinal: chunk.ordinal,
    }))
}

export function listAudit(db: DB, limit = 200) {
  return db.select().from(auditLog).orderBy(desc(auditLog.at)).limit(limit).all()
}

export function listOutbound(db: DB) {
  return db.select().from(outboundMessages).orderBy(desc(outboundMessages.createdAt)).all()
}

export function findUserByEmail(db: DB, email: string) {
  return db.select().from(users).where(eq(users.email, email.toLowerCase())).get() ?? null
}

export function createSession(db: DB, userId: string, ttlMs = 7 * 24 * 60 * 60 * 1000) {
  const at = now()
  const row = { id: id('ses'), userId, expiresAt: at + ttlMs, createdAt: at }
  db.insert(sessions).values(row).run()
  return row
}

export function getSession(db: DB, sessionId: string) {
  const row = db.select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!row) return null
  if (row.expiresAt < now()) return null
  const user = db.select().from(users).where(eq(users.id, row.userId)).get()
  if (!user) return null
  return { session: row, user }
}

export function deleteSession(db: DB, sessionId: string): void {
  db.delete(sessions).where(eq(sessions.id, sessionId)).run()
}

export function dashboard(db: DB) {
  const inquiryRows = listInquiries(db)
  const approvalRows = listApprovals(db)
  const quoteRows = listQuotes(db)
  const dealRows = listDeals(db)
  const open = inquiryRows.filter((row) => ['new', 'processing', 'awaiting_approval'].includes(row.status)).length
  const pending = approvalRows.filter((row) => row.status === 'pending')
  const pipelineCents = dealRows
    .filter((row) => row.stage === 'lead' || row.stage === 'qualified' || row.stage === 'proposal')
    .reduce((sum, row) => sum + row.amountCents, 0)
  const stages = ['lead', 'qualified', 'proposal', 'won', 'lost'].map((stage) => ({
    stage,
    count: dealRows.filter((row) => row.stage === stage).length,
    amountCents: dealRows.filter((row) => row.stage === stage).reduce((sum, row) => sum + row.amountCents, 0),
  }))
  return {
    openInquiries: open,
    pendingApprovals: pending.length,
    quotes: quoteRows.length,
    sentQuotes: quoteRows.filter((row) => row.status === 'sent').length,
    pipelineCents,
    stages,
    recentInquiries: inquiryRows.slice(0, 6),
    queue: pending.slice(0, 5).map((approval) => {
      const run = getRun(db, approval.runId)
      const inquiry = run ? getInquiry(db, run.inquiryId) : null
      return { ...approval, companyName: inquiry?.companyName ?? null, inquirySubject: inquiry?.subject ?? null }
    }),
    recentRuns: db.select().from(agentRuns).orderBy(desc(agentRuns.startedAt)).limit(6).all().map((run) => {
      const inquiry = getInquiry(db, run.inquiryId)
      return { ...run, companyName: inquiry?.companyName ?? null, subject: inquiry?.subject ?? null }
    }),
    activity: listAudit(db, 8),
  }
}

export function listCalls(db: DB) {
  return db.select().from(calls).orderBy(desc(calls.createdAt)).all()
}

export function getCall(db: DB, callId: string) {
  return db.select().from(calls).where(eq(calls.id, callId)).get() ?? null
}

export function insertCall(
  db: DB,
  input: {
    id?: string
    vapiCallId?: string | null
    visitorHash?: string | null
    fromNumber?: string | null
    callerName?: string | null
    companyName?: string | null
    inquiryId?: string | null
    status: string
    summary?: string | null
    transcript?: string | null
    outcome?: string | null
    startedAt?: number | null
    endedAt?: number | null
  },
) {
  const row = {
    id: input.id ?? id('call'),
    vapiCallId: input.vapiCallId ?? null,
    visitorHash: input.visitorHash ?? null,
    fromNumber: input.fromNumber ?? null,
    callerName: input.callerName ?? null,
    companyName: input.companyName ?? null,
    inquiryId: input.inquiryId ?? null,
    status: input.status,
    summary: input.summary ?? null,
    transcript: input.transcript ?? null,
    outcome: input.outcome ?? null,
    startedAt: input.startedAt ?? null,
    endedAt: input.endedAt ?? null,
    createdAt: now(),
  }
  db.insert(calls).values(row).run()
  return row
}

export function counts(db: DB) {
  const inquiriesCount = db.select({ n: sql<number>`count(*)` }).from(inquiries).get()?.n ?? 0
  const dealsCount = db.select({ n: sql<number>`count(*)` }).from(crmDeals).get()?.n ?? 0
  return { inquiries: Number(inquiriesCount), deals: Number(dealsCount) }
}
