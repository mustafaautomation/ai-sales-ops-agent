import {
  dashboard,
  getApproval,
  getCall,
  getInquiry,
  getQuote,
  getRun,
  listApprovals,
  listAudit,
  listCalls,
  listCompanies,
  listContacts,
  listDeals,
  listDocuments,
  listInquiries,
  listQuotes,
  listRunsForInquiry,
  listSteps,
  loadChunks,
  numberSetting,
  OPERATOR,
  pendingApprovalForRun,
  searchChunks,
} from '@meridian/core'
import { deskDb } from './desk'

export function workerConfigured(): boolean {
  return Boolean(process.env.WORKER_URL)
}

export async function workerGet<T>(path: string): Promise<T> {
  const response = await fetch(`${process.env.WORKER_URL}${path}`, {
    headers: { authorization: `Bearer ${process.env.WORKER_AUTH_TOKEN ?? ''}` },
    cache: 'no-store',
  })
  if (response.status === 404) return null as T
  if (!response.ok) throw new Error(`Worker ${path} returned ${response.status}`)
  return response.json() as Promise<T>
}

export async function workerPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${process.env.WORKER_URL}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.WORKER_AUTH_TOKEN ?? ''}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  const text = await response.text()
  const payload = text ? (JSON.parse(text) as { error?: string }) : {}
  if (!response.ok) throw new Error(payload.error || `Worker ${path} returned ${response.status}`)
  return payload as T
}

type Inquiry = NonNullable<ReturnType<typeof getInquiry>>
type Run = NonNullable<ReturnType<typeof getRun>>
type Step = ReturnType<typeof listSteps>[number]
type Approval = NonNullable<ReturnType<typeof getApproval>> & { inquirySubject?: string | null }
type QuoteDetail = NonNullable<ReturnType<typeof getQuote>>
type Call = NonNullable<ReturnType<typeof getCall>>
type Dashboard = ReturnType<typeof dashboard>
type Company = ReturnType<typeof listCompanies>[number]
type Deal = ReturnType<typeof listDeals>[number]
type Contact = ReturnType<typeof listContacts>[number]

export async function sourceInquiries() {
  if (!workerConfigured()) return listInquiries(deskDb())
  const payload = await workerGet<{ inquiries: Inquiry[] }>('/api/inquiries')
  return payload.inquiries
}

export async function sourceApprovals() {
  if (!workerConfigured()) {
    const db = deskDb()
    return listApprovals(db).map((approval) => {
      const run = getRun(db, approval.runId)
      const inquiry = run ? getInquiry(db, run.inquiryId) : null
      return { ...approval, inquirySubject: inquiry?.subject ?? null }
    })
  }
  const payload = await workerGet<{ approvals: Approval[] }>('/api/approvals')
  return payload.approvals
}

export async function sourceQuotes() {
  if (!workerConfigured()) return listQuotes(deskDb())
  const payload = await workerGet<{ quotes: QuoteDetail['quote'][] }>('/api/quotes')
  return payload.quotes
}

export async function sourceCalls() {
  if (!workerConfigured()) return listCalls(deskDb())
  const payload = await workerGet<{ calls: Call[] }>('/api/calls')
  return payload.calls
}

export async function sourceCrm() {
  if (!workerConfigured()) {
    const db = deskDb()
    return { companies: listCompanies(db), deals: listDeals(db), contacts: listContacts(db) }
  }
  return workerGet<{ companies: Company[]; deals: Deal[]; contacts: Contact[] }>('/api/crm')
}

export async function sourceAudit() {
  if (!workerConfigured()) return listAudit(deskDb())
  const payload = await workerGet<{ audit: ReturnType<typeof listAudit> }>('/api/audit')
  return payload.audit ?? []
}

export async function sourceDashboard() {
  if (!workerConfigured()) return dashboard(deskDb())
  return workerGet<Dashboard>('/api/dashboard')
}

export async function sourceInquiry(id: string) {
  if (!workerConfigured()) {
    const db = deskDb()
    const inquiry = getInquiry(db, id)
    if (!inquiry) return null
    const runs = listRunsForInquiry(db, id)
    const steps = runs[0] ? listSteps(db, runs[0].id) : []
    const classify = steps.find((step) => step.toolName === 'classify')
    let classification: { intent?: string; signals?: string[] } | null = null
    if (classify?.resultJson) {
      try { classification = JSON.parse(classify.resultJson) as { intent?: string; signals?: string[] } } catch { classification = null }
    }
    const quotes = listQuotes(db).filter((quote) => quote.inquiryId === id)
    const deals = listDeals(db).filter((deal) => deal.inquiryId === id)
    const approvals = listApprovals(db).filter((approval) => runs.some((run) => run.id === approval.runId))
    const ids = new Set([id, ...runs.map((run) => run.id), ...approvals.map((approval) => approval.id)])
    const audit = listAudit(db).filter((row) => ids.has(row.entityId))
    return { inquiry, runs, quotes, deals, approvals, audit, classification }
  }
  return workerGet<{
    inquiry: Inquiry
    runs: Run[]
    quotes?: QuoteDetail['quote'][]
    deals?: Deal[]
    approvals?: Approval[]
    audit?: ReturnType<typeof listAudit>
    classification?: { intent?: string; signals?: string[] } | null
  } | null>(`/api/inquiries/${id}`)
}

export async function sourceRun(id: string) {
  if (!workerConfigured()) {
    const db = deskDb()
    const run = getRun(db, id)
    if (!run) return null
    const decided = new Map(listApprovals(db).filter((approval) => approval.runId === id).map((approval) => [approval.id, approval.decidedAt]))
    const steps = listSteps(db, id).map((step) => ({ ...step, approvalDecidedAt: step.approvalId ? decided.get(step.approvalId) ?? null : null }))
    return { run, inquiry: getInquiry(db, run.inquiryId), steps, pending: pendingApprovalForRun(db, id) }
  }
  return workerGet<{ run: Run; inquiry: Inquiry | null; steps: Step[]; pending: Approval | null } | null>(`/api/runs/${id}`)
}

export async function sourceApproval(id: string) {
  if (!workerConfigured()) {
    const db = deskDb()
    const approval = getApproval(db, id)
    if (!approval) return null
    const run = getRun(db, approval.runId)
    const inquiry = run ? getInquiry(db, run.inquiryId) : null
    return { approval, run, inquiry }
  }
  return workerGet<{ approval: Approval; run: Run | null; inquiry: Inquiry | null } | null>(`/api/approvals/${id}`)
}

export async function sourceQuote(id: string) {
  if (!workerConfigured()) return getQuote(deskDb(), id)
  return workerGet<QuoteDetail | null>(`/api/quotes/${id}`)
}

export async function sourceCall(id: string) {
  if (!workerConfigured()) {
    const db = deskDb()
    const call = getCall(db, id)
    if (!call) return null
    return { call, inquiry: call.inquiryId ? getInquiry(db, call.inquiryId) : null }
  }
  return workerGet<{ call: Call; inquiry: Inquiry | null } | null>(`/api/calls/${id}`)
}

export async function sourceIntegrations() {
  if (!workerConfigured()) {
    return {
      resendKeyPresent: false,
      emailEnabled: false,
      emailFrom: 'Meridian Desk <desk@quvantic.com>',
      callsEnabled: false,
      callMode: 'browser' as const,
      outboundNumberConfigured: false,
      caps: { emailsPerAddress: 2, emailsGlobal: 50, callsPerNumber: 1, callsGlobal: 10 },
    }
  }
  return workerGet<{
    resendKeyPresent: boolean
    emailEnabled: boolean
    emailFrom: string
    callsEnabled: boolean
    callMode: 'browser' | 'phone'
    outboundNumberConfigured: boolean
    caps: { emailsPerAddress: number; emailsGlobal: number; callsPerNumber: number; callsGlobal: number }
  }>('/api/integrations')
}

export async function sourceSettings() {
  if (!workerConfigured()) {
    const db = deskDb()
    return { taxBps: numberSetting(db, 'tax_bps', 825), quoteValidDays: numberSetting(db, 'quote_valid_days', 14) }
  }
  return workerGet<{ taxBps: number; quoteValidDays: number }>('/api/settings')
}

export async function sourceKnowledge(query: { doc?: string; q?: string }) {
  if (!workerConfigured()) {
    const db = deskDb()
    const documents = listDocuments(db)
    const selectedDoc = documents.find((doc) => doc.slug === query.doc) ?? documents[0] ?? null
    const selected = selectedDoc ? { ...selectedDoc, body: selectedDoc.body } : null
    const hits = query.q ? searchChunks(loadChunks(db), query.q, 6) : []
    return { documents, selected, hits }
  }
  const params = new URLSearchParams()
  if (query.doc) params.set('doc', query.doc)
  if (query.q) params.set('q', query.q)
  const suffix = params.size ? `?${params.toString()}` : ''
  return workerGet<{
    documents: { id: string; slug: string; title: string; body: string }[]
    selected: { id: string; slug: string; title: string; body: string } | null
    hits: { slug: string; title: string; heading: string; content: string; ordinal: number }[]
  }>(`/api/kb${suffix}`)
}

export async function voiceMode(): Promise<'token' | 'public-key'> {
  if (workerConfigured()) {
    try {
      const payload = await workerGet<{ mode?: string }>('/api/voice/mode')
      return payload?.mode === 'token' ? 'token' : 'public-key'
    } catch {
      return 'public-key'
    }
  }
  if (process.env.VAPI_PRIVATE_KEY && process.env.VAPI_ORG_ID) return 'token'
  return 'public-key'
}

export function consoleUser(sessionUser?: { name: string; email: string }) {
  if (workerConfigured()) return { name: OPERATOR.name, email: OPERATOR.email }
  return sessionUser ?? { name: OPERATOR.name, email: OPERATOR.email }
}
