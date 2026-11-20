import { allChunks, KB_DOCS, searchChunks } from '../../packages/core/src/kb'
import type { D1Like } from './d1'
import { camelRow, listRows } from './desk'

async function one<T>(db: D1Like, sql: string, ...args: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...args).first<T>()
}

async function many<T>(db: D1Like, sql: string, ...args: unknown[]): Promise<T[]> {
  const result = await db.prepare(sql).bind(...args).all<T>()
  return result.results
}

export async function dashboard(db: D1Like) {
  const inquiries = await listRows(db, 'inquiries')
  const approvals = await listApprovals(db)
  const quotes = await listRows(db, 'quotes')
  const deals = await listRows(db, 'crm_deals')
  const open = inquiries.filter((row) => ['new', 'processing', 'awaiting_approval'].includes(String(row.status))).length
  const pending = approvals.filter((row) => row.status === 'pending')
  const stages = ['lead', 'qualified', 'proposal', 'won', 'lost'].map((stage) => {
    const rows = deals.filter((row) => row.stage === stage)
    return {
      stage,
      count: rows.length,
      amountCents: rows.reduce((sum, row) => sum + Number(row.amountCents ?? 0), 0),
    }
  })
  return {
    openInquiries: open,
    pendingApprovals: pending.length,
    quotes: quotes.length,
    sentQuotes: quotes.filter((row) => row.status === 'sent').length,
    pipelineCents: stages.filter((stage) => stage.stage === 'lead' || stage.stage === 'qualified' || stage.stage === 'proposal').reduce((sum, stage) => sum + stage.amountCents, 0),
    stages,
    recentInquiries: inquiries.slice(0, 6),
    queue: pending.slice(0, 5),
  }
}

export async function listApprovals(db: D1Like): Promise<Record<string, unknown>[]> {
  const rows = await many<Record<string, unknown>>(
    db,
    `SELECT approvals.*, inquiries.subject AS inquiry_subject
     FROM approvals
     LEFT JOIN agent_runs ON agent_runs.id = approvals.run_id
     LEFT JOIN inquiries ON inquiries.id = agent_runs.inquiry_id
     ORDER BY approvals.rowid DESC LIMIT 100`,
  )
  return rows.map(camelRow)
}

export async function inquiryDetail(db: D1Like, id: string) {
  const inquiry = await one<Record<string, unknown>>(db, 'SELECT * FROM inquiries WHERE id = ?', id)
  if (!inquiry) return null
  const runs = await many<Record<string, unknown>>(db, 'SELECT * FROM agent_runs WHERE inquiry_id = ? ORDER BY started_at DESC', id)
  return { inquiry: camelRow(inquiry), runs: runs.map(camelRow) }
}

export async function runDetail(db: D1Like, id: string) {
  const run = await one<Record<string, unknown>>(db, 'SELECT * FROM agent_runs WHERE id = ?', id)
  if (!run) return null
  const inquiry = await one<Record<string, unknown>>(db, 'SELECT * FROM inquiries WHERE id = ?', run.inquiry_id)
  const steps = await many<Record<string, unknown>>(db, 'SELECT * FROM agent_steps WHERE run_id = ? ORDER BY step_index', id)
  const pending = await one<Record<string, unknown>>(db, `SELECT * FROM approvals WHERE run_id = ? AND status = 'pending' LIMIT 1`, id)
  return {
    run: camelRow(run),
    inquiry: inquiry ? camelRow(inquiry) : null,
    steps: steps.map(camelRow),
    pending: pending ? camelRow(pending) : null,
  }
}

export async function approvalDetail(db: D1Like, id: string) {
  const approval = await one<Record<string, unknown>>(db, 'SELECT * FROM approvals WHERE id = ?', id)
  if (!approval) return null
  const run = await one<Record<string, unknown>>(db, 'SELECT * FROM agent_runs WHERE id = ?', approval.run_id)
  const inquiry = run ? await one<Record<string, unknown>>(db, 'SELECT * FROM inquiries WHERE id = ?', run.inquiry_id) : null
  return { approval: camelRow(approval), run: run ? camelRow(run) : null, inquiry: inquiry ? camelRow(inquiry) : null }
}

export async function quoteDetail(db: D1Like, id: string) {
  const quote = await one<Record<string, unknown>>(db, 'SELECT * FROM quotes WHERE id = ?', id)
  if (!quote) return null
  const lines = await many<Record<string, unknown>>(db, 'SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY position', id)
  return { quote: camelRow(quote), lines: lines.map(camelRow) }
}

export async function callDetail(db: D1Like, id: string) {
  const call = await one<Record<string, unknown>>(db, 'SELECT * FROM calls WHERE id = ?', id)
  if (!call) return null
  const inquiry = call.inquiry_id ? await one<Record<string, unknown>>(db, 'SELECT * FROM inquiries WHERE id = ?', call.inquiry_id) : null
  return { call: camelRow(call), inquiry: inquiry ? camelRow(inquiry) : null }
}

export async function settingsView(db: D1Like) {
  const tax = await one<{ value: string }>(db, `SELECT value FROM settings WHERE key = 'tax_bps'`)
  const days = await one<{ value: string }>(db, `SELECT value FROM settings WHERE key = 'quote_valid_days'`)
  return { taxBps: Number(tax?.value ?? 825), quoteValidDays: Number(days?.value ?? 14) }
}

export async function saveSettings(db: D1Like, taxBps: number, quoteValidDays: number): Promise<void> {
  if (!Number.isInteger(taxBps) || taxBps < 0 || taxBps > 3000) throw new Error('Tax basis points must be 0 to 3000')
  if (!Number.isInteger(quoteValidDays) || quoteValidDays < 1 || quoteValidDays > 90) throw new Error('Validity must be 1 to 90 days')
  for (const [key, value] of [['tax_bps', String(taxBps)], ['quote_valid_days', String(quoteValidDays)]] as const) {
    await db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(key, value).run()
  }
}

export function knowledgeView(query: { doc?: string | null; q?: string | null }) {
  const documents = KB_DOCS.map((doc) => ({ id: doc.slug, slug: doc.slug, title: doc.title, body: doc.body }))
  const selected = documents.find((doc) => doc.slug === query.doc) ?? documents[0] ?? null
  const hits = query.q
    ? searchChunks(allChunks(KB_DOCS), query.q, 6).map((hit) => ({
        slug: hit.slug,
        title: hit.title,
        heading: hit.heading,
        content: hit.content,
        ordinal: hit.ordinal,
      }))
    : []
  return { documents, selected, hits }
}
