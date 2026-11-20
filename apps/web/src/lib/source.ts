import { OPERATOR, listApprovals, listAudit, listCalls, listCompanies, listDeals, listInquiries, listQuotes } from '@meridian/core'
import { deskDb } from './desk'

export function workerConfigured(): boolean {
  return Boolean(process.env.WORKER_URL)
}

async function workerGet<T>(path: string): Promise<T> {
  const response = await fetch(`${process.env.WORKER_URL}${path}`, {
    headers: { authorization: `Bearer ${process.env.WORKER_AUTH_TOKEN ?? ''}` },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`Worker ${path} returned ${response.status}`)
  return response.json() as Promise<T>
}

export async function sourceInquiries() {
  if (!workerConfigured()) return listInquiries(deskDb())
  const payload = await workerGet<{ inquiries: ReturnType<typeof listInquiries> }>('/api/inquiries')
  return payload.inquiries
}

export async function sourceApprovals() {
  if (!workerConfigured()) return listApprovals(deskDb())
  const payload = await workerGet<{ approvals: ReturnType<typeof listApprovals> }>('/api/approvals')
  return payload.approvals
}

export async function sourceQuotes() {
  if (!workerConfigured()) return listQuotes(deskDb())
  const payload = await workerGet<{ quotes: ReturnType<typeof listQuotes> }>('/api/quotes')
  return payload.quotes
}

export async function sourceCalls() {
  if (!workerConfigured()) return listCalls(deskDb())
  const payload = await workerGet<{ calls: ReturnType<typeof listCalls> }>('/api/calls')
  return payload.calls
}

export async function sourceCrm() {
  if (!workerConfigured()) return { companies: listCompanies(deskDb()), deals: listDeals(deskDb()) }
  return workerGet<{ companies: ReturnType<typeof listCompanies>; deals: ReturnType<typeof listDeals> }>('/api/crm')
}

export async function sourceAudit() {
  if (!workerConfigured()) return listAudit(deskDb())
  const payload = await workerGet<{ audit: ReturnType<typeof listAudit> }>('/api/audit')
  return payload.audit ?? []
}

export function consoleUser(sessionUser?: { name: string; email: string }) {
  if (workerConfigured()) return { name: OPERATOR.name, email: OPERATOR.email }
  return sessionUser ?? { name: OPERATOR.name, email: OPERATOR.email }
}
