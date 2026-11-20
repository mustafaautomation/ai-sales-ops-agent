import { fetchWithRetry, type FetchLike } from './retry'

export type MailMessage = {
  id: string
  direction: 'inbound' | 'outbound'
  from: string
  to: string
  subject: string
  body: string
  clientKey: string | null
  createdAt: string
}

export type CrmRecord = {
  externalKey: string
  companyName: string
  contactName: string | null
  contactEmail: string | null
  dealTitle: string | null
  stage: string | null
  amountCents: number | null
  quoteNumber: string | null
  domain: string | null
}

export type CrmUpsert = {
  externalKey: string
  companyName: string
  contactName: string
  contactEmail: string
  dealTitle: string
  stage: 'lead' | 'qualified' | 'proposal' | 'won' | 'lost'
  amountCents: number
  quoteNumber: string | null
}

export interface EmailPort {
  listInbound(): Promise<MailMessage[]>
  ingest(input: { from: string; to: string; subject: string; body: string; clientKey: string }): Promise<MailMessage>
  send(input: { to: string; from: string; subject: string; body: string; clientKey: string }): Promise<MailMessage>
}

export interface CrmPort {
  lookup(query: string): Promise<CrmRecord[]>
  upsert(input: CrmUpsert, clientKey: string): Promise<CrmRecord>
}

export type Ports = { email: EmailPort; crm: CrmPort }

export const DESK_FROM = 'desk@meridian-facilities.example'

async function asJson<T>(response: Response, label: string): Promise<T> {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${label} returned ${response.status}: ${text.slice(0, 240)}`)
  }
  return JSON.parse(text) as T
}

export function httpPorts(options: {
  emailBaseUrl: string
  crmBaseUrl: string
  fetchImpl?: FetchLike
  attempts?: number
  timeoutMs?: number
}): Ports {
  const retry = {
    fetch: options.fetchImpl,
    attempts: options.attempts ?? 4,
    baseDelayMs: 150,
    timeoutMs: options.timeoutMs ?? 4_000,
    jitter: false,
  }
  const emailRoot = options.emailBaseUrl.replace(/\/$/, '')
  const crmRoot = options.crmBaseUrl.replace(/\/$/, '')
  return {
    email: {
      async listInbound() {
        const response = await fetchWithRetry(`${emailRoot}/v1/messages?direction=inbound`, {}, retry)
        const payload = await asJson<{ messages: MailMessage[] }>(response, 'email list')
        return payload.messages
      },
      async ingest(input) {
        const response = await fetchWithRetry(
          `${emailRoot}/v1/messages`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'idempotency-key': input.clientKey },
            body: JSON.stringify({ direction: 'inbound', ...input }),
          },
          retry,
        )
        return asJson<MailMessage>(response, 'email ingest')
      },
      async send(input) {
        const response = await fetchWithRetry(
          `${emailRoot}/v1/messages`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'idempotency-key': input.clientKey },
            body: JSON.stringify({ direction: 'outbound', ...input }),
          },
          retry,
        )
        return asJson<MailMessage>(response, 'email send')
      },
    },
    crm: {
      async lookup(query) {
        const response = await fetchWithRetry(
          `${crmRoot}/v1/records?q=${encodeURIComponent(query)}`,
          {},
          retry,
        )
        const payload = await asJson<{ records: CrmRecord[] }>(response, 'crm lookup')
        return payload.records
      },
      async upsert(input, clientKey) {
        const response = await fetchWithRetry(
          `${crmRoot}/v1/upsert`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'idempotency-key': clientKey },
            body: JSON.stringify(input),
          },
          retry,
        )
        return asJson<CrmRecord>(response, 'crm upsert')
      },
    },
  }
}

export function memoryPorts(): Ports & {
  sent: MailMessage[]
  ingested: MailMessage[]
  crmRecords: Map<string, CrmRecord>
} {
  const sent: MailMessage[] = []
  const ingested: MailMessage[] = []
  const crmRecords = new Map<string, CrmRecord>()
  return {
    sent,
    ingested,
    crmRecords,
    email: {
      async listInbound() {
        return ingested.filter((message) => message.direction === 'inbound')
      },
      async ingest(input) {
        const existing = ingested.find((message) => message.clientKey === input.clientKey)
        if (existing) return existing
        const message: MailMessage = {
          id: `mem_${ingested.length + 1}`,
          direction: 'inbound',
          from: input.from,
          to: input.to,
          subject: input.subject,
          body: input.body,
          clientKey: input.clientKey,
          createdAt: new Date().toISOString(),
        }
        ingested.push(message)
        return message
      },
      async send(input) {
        const existing = sent.find((message) => message.clientKey === input.clientKey)
        if (existing) return existing
        const message: MailMessage = {
          id: `out_${sent.length + 1}`,
          direction: 'outbound',
          from: input.from,
          to: input.to,
          subject: input.subject,
          body: input.body,
          clientKey: input.clientKey,
          createdAt: new Date().toISOString(),
        }
        sent.push(message)
        return message
      },
    },
    crm: {
      async lookup(query) {
        const needle = query.trim().toLowerCase()
        return [...crmRecords.values()].filter((record) => {
          if (!needle) return true
          return JSON.stringify(record).toLowerCase().includes(needle)
        })
      },
      async upsert(input, _clientKey) {
        const record: CrmRecord = { ...input, domain: null }
        crmRecords.set(input.externalKey, record)
        return record
      },
    },
  }
}
