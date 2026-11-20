import { allChunks, KB_DOCS, searchChunks } from '../../packages/core/src/kb'
import { maskPayloadSecrets } from '../../packages/core/src/mask'
import type { D1Like } from './d1'
import { camelRow, listRows } from './desk'

async function one<T>(db: D1Like, sql: string, ...args: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...args).first<T>()
}

async function many<T>(db: D1Like, sql: string, ...args: unknown[]): Promise<T[]> {
  const result = await db.prepare(sql).bind(...args).all<T>()
  return result.results
}

export async function dashboard(db: D1Like, opts: { seedOnly?: boolean } = {}) {
  const seed = Boolean(opts.seedOnly)
  const keep = (row: Record<string, unknown>, keys: string[] = ['id']) =>
    !seed || keys.some((key) => String(row[key] ?? '').includes('_seed_'))
  const inquiries = (await listRows(db, 'inquiries')).filter((row) => keep(row))
  const approvals = (await listApprovals(db)).filter((row) => keep(row) || keep(row, ['runId']))
  const quotes = (await listRows(db, 'quotes')).filter((row) => keep(row))
  const deals = (await listRows(db, 'crm_deals')).filter((row) => keep(row))
  const openRows = inquiries.filter((row) => ['new', 'processing', 'awaiting_approval'].includes(String(row.status)))
  const pending = approvals.filter((row) => row.status === 'pending')
  const stages = ['lead', 'qualified', 'proposal', 'won', 'lost'].map((stage) => {
    const rows = deals.filter((row) => row.stage === stage)
    return {
      stage,
      count: rows.length,
      amountCents: rows.reduce((sum, row) => sum + Number(row.amountCents ?? 0), 0),
    }
  })
  const runs = await many<Record<string, unknown>>(
    db,
    `SELECT agent_runs.id, agent_runs.status, agent_runs.provider, agent_runs.started_at, agent_runs.finished_at,
            inquiries.company_name, inquiries.from_name, inquiries.subject,
            (SELECT COALESCE(SUM(finished_at - started_at), 0) FROM agent_steps WHERE run_id = agent_runs.id AND started_at IS NOT NULL AND finished_at >= started_at) AS agent_ms
     FROM agent_runs LEFT JOIN inquiries ON inquiries.id = agent_runs.inquiry_id
     ${seed ? "WHERE agent_runs.id LIKE '%_seed_%'" : ''}
     ORDER BY agent_runs.started_at DESC LIMIT 6`,
  )
  const activity = (await listRows(db, 'audit_log')).filter((row) => keep(row) || keep(row, ['entityId']))
  const aiLimit = seed
    ? null
    : await one<{ id: string }>(
      db,
      `SELECT id FROM approvals
     WHERE tool_name = 'human_review' AND status = 'pending'
       AND (note LIKE '%AI daily limit%' OR note LIKE '%4006%' OR note LIKE '%429%' OR proposed_json LIKE '%AI daily limit%' OR proposed_json LIKE '%4006%' OR proposed_json LIKE '%429%')
     LIMIT 1`,
    )
  return {
    openInquiries: openRows.length,
    pendingApprovals: pending.length,
    quotes: quotes.length,
    sentQuotes: quotes.filter((row) => row.status === 'sent').length,
    pipelineCents: stages.filter((stage) => stage.stage === 'lead' || stage.stage === 'qualified' || stage.stage === 'proposal').reduce((sum, stage) => sum + stage.amountCents, 0),
    stages,
    recentInquiries: openRows,
    queue: pending,
    recentRuns: runs.map(camelRow),
    activity: activity.slice(0, 8),
    aiDailyLimit: Boolean(aiLimit),
  }
}

export async function listApprovals(db: D1Like): Promise<Record<string, unknown>[]> {
  const rows = await many<Record<string, unknown>>(
    db,
    `SELECT approvals.*, inquiries.subject AS inquiry_subject, inquiries.company_name AS company_name
     FROM approvals
     LEFT JOIN agent_runs ON agent_runs.id = approvals.run_id
     LEFT JOIN inquiries ON inquiries.id = agent_runs.inquiry_id
     ORDER BY approvals.created_at DESC, approvals.rowid DESC LIMIT 100`,
  )
  return rows.map(camelRow)
}

export async function listRunsView(db: D1Like, opts: { seedOnly?: boolean } = {}) {
  const seed = Boolean(opts.seedOnly)
  const rows = await many<Record<string, unknown>>(
    db,
    `SELECT agent_runs.id, agent_runs.status, agent_runs.provider, agent_runs.started_at, agent_runs.finished_at,
            inquiries.company_name, inquiries.from_name, inquiries.subject, inquiries.intent,
            (SELECT COALESCE(SUM(finished_at - started_at), 0) FROM agent_steps WHERE run_id = agent_runs.id AND started_at IS NOT NULL AND finished_at >= started_at) AS agent_ms
     FROM agent_runs LEFT JOIN inquiries ON inquiries.id = agent_runs.inquiry_id
     ${seed ? "WHERE agent_runs.id LIKE '%_seed_%'" : ''}
     ORDER BY agent_runs.started_at DESC LIMIT 100`,
  )
  return rows.map(camelRow)
}

export async function inquiryDetail(db: D1Like, id: string) {
  const inquiry = await one<Record<string, unknown>>(db, 'SELECT * FROM inquiries WHERE id = ?', id)
  if (!inquiry) return null
  const runs = await many<Record<string, unknown>>(db, 'SELECT * FROM agent_runs WHERE inquiry_id = ? ORDER BY started_at DESC', id)
  const runIds = runs.map((run) => String(run.id))
  const classify = runIds[0]
    ? await one<{ result_json: string | null }>(db, `SELECT result_json FROM agent_steps WHERE run_id = ? AND tool_name = 'classify' ORDER BY step_index LIMIT 1`, runIds[0])
    : null
  const quotes = await many<Record<string, unknown>>(db, 'SELECT * FROM quotes WHERE inquiry_id = ? ORDER BY created_at DESC', id)
  const deals = await many<Record<string, unknown>>(db, 'SELECT * FROM crm_deals WHERE inquiry_id = ? ORDER BY updated_at DESC', id)
  const approvals = runIds.length === 0
    ? []
    : await many<Record<string, unknown>>(db, `SELECT * FROM approvals WHERE run_id IN (${runIds.map(() => '?').join(',')}) ORDER BY created_at DESC`, ...runIds)
  const auditIds = [id, ...runIds, ...approvals.map((row) => String(row.id))]
  const audit = auditIds.length === 0
    ? []
    : await many<Record<string, unknown>>(db, `SELECT * FROM audit_log WHERE entity_id IN (${auditIds.map(() => '?').join(',')}) ORDER BY at DESC`, ...auditIds)
  let classification: { intent?: string; signals?: string[] } | null = null
  if (classify?.result_json) {
    try { classification = JSON.parse(classify.result_json) as { intent?: string; signals?: string[] } } catch { classification = null }
  }
  return {
    inquiry: camelRow(inquiry),
    runs: runs.map(camelRow),
    quotes: quotes.map(camelRow),
    deals: deals.map(camelRow),
    approvals: approvals.map(camelRow),
    audit: audit.map(camelRow),
    classification,
  }
}

export async function runDetail(db: D1Like, id: string) {
  const run = await one<Record<string, unknown>>(db, 'SELECT * FROM agent_runs WHERE id = ?', id)
  if (!run) return null
  const inquiry = await one<Record<string, unknown>>(db, 'SELECT * FROM inquiries WHERE id = ?', run.inquiry_id)
  const steps = await many<Record<string, unknown>>(db, `SELECT agent_steps.*, approvals.decided_at AS approval_decided_at FROM agent_steps LEFT JOIN approvals ON approvals.id = agent_steps.approval_id WHERE agent_steps.run_id = ? ORDER BY agent_steps.step_index`, id)
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
  const row = camelRow(approval)
  if (typeof row.proposedJson === 'string') row.proposedJson = maskPayloadSecrets(row.proposedJson)
  if (typeof row.finalJson === 'string') row.finalJson = maskPayloadSecrets(row.finalJson)
  return { approval: row, run: run ? camelRow(run) : null, inquiry: inquiry ? camelRow(inquiry) : null }
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
