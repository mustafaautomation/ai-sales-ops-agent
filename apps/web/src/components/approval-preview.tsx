import { money } from '../lib/format'
import { maskPhone } from '@meridian/core'

type Email = {
  to?: string
  subject?: string
  body?: string
  purpose?: string
  quoteId?: string | null
}

type Crm = {
  companyName?: string
  contactName?: string
  contactEmail?: string
  dealTitle?: string
  stage?: string
  amountCents?: number
  quoteId?: string | null
  quoteNumber?: string | null
  inquiryId?: string | null
}

function parsed(value: string): Record<string, unknown> | null {
  try {
    const data = JSON.parse(value) as unknown
    return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null
  } catch {
    return null
  }
}

export function splitDeskEmail(body: string): { main: string; sources: string[]; signOff: string; stop: string } {
  const stopMatch = body.match(/\n*To stop all contact:\s*(\S+)\s*$/i)
  const stop = stopMatch?.[1] ?? ''
  const withoutStop = stopMatch && stopMatch.index != null ? body.slice(0, stopMatch.index).trimEnd() : body.trimEnd()
  const signOffMatch = withoutStop.match(/\n*Meridian Facilities sales desk\nCedarhaven\s*$/)
  const signOff = signOffMatch ? 'Meridian Facilities sales desk\nCedarhaven' : ''
  const withoutSign = signOffMatch && signOffMatch.index != null ? withoutStop.slice(0, signOffMatch.index).trimEnd() : withoutStop
  const marker = '\nSources:\n'
  const sourceAt = withoutSign.indexOf(marker)
  const main = (sourceAt >= 0 ? withoutSign.slice(0, sourceAt) : withoutSign).trimEnd()
  const sourceBlock = sourceAt >= 0 ? withoutSign.slice(sourceAt + marker.length) : ''
  const sources = sourceBlock
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\s/.test(line))
    .map((line) => line.replace(/^\d+\.\s*/, ''))
  return { main, sources, signOff, stop }
}

export function ApprovalPreview({ tool, payload, mode }: { tool: string; payload: string; mode?: 'browser' | 'phone' }) {
  const data = parsed(payload)
  if (!data) return <pre className="json">{payload}</pre>
  if (tool === 'request_callback') {
    const phone = String(data.phone ?? '')
    const topic = String(data.subject ?? 'this inquiry')
    return (
      <article className="email-preview">
        <p>AI will call back {phone ? maskPhone(phone) : 'the lead'} about {topic}. Mode: {mode === 'phone' ? 'phone' : 'browser'}.</p>
      </article>
    )
  }
  if (tool === 'send_email') return <EmailPreview email={data as Email} />
  if (tool === 'crm_upsert') return <CrmPreview crm={data as Crm} />
  return (
    <dl className="fields">
      {Object.entries(data).map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

function EmailPreview({ email }: { email: Email }) {
  const { main, sources, signOff, stop } = splitDeskEmail(String(email.body ?? '').replace(/\\n/g, '\n'))
  return (
    <article className="email-preview">
      <dl className="fields">
        <div><dt>To</dt><dd>{email.to}</dd></div>
        <div><dt>Subject</dt><dd>{email.subject}</dd></div>
      </dl>
      <pre className="email-body">{main}</pre>
      {sources.length > 0 ? (
        <>
          <h2>Sources</h2>
          <ol className="sources">
            {sources.map((source) => <li key={source}>{source}</li>)}
          </ol>
        </>
      ) : null}
      {signOff ? <p className="signoff">{signOff}</p> : null}
      {stop ? <p className="muted">To stop all contact: {stop}</p> : null}
    </article>
  )
}

function CrmPreview({ crm }: { crm: Crm }) {
  const amount = typeof crm.amountCents === 'number' ? money(crm.amountCents) : '—'
  const rows: [string, string][] = [
    ['Company', crm.companyName || '—'],
    ['Contact', [crm.contactName, crm.contactEmail].filter(Boolean).join(' · ') || '—'],
    ['Deal', crm.dealTitle || '—'],
    ['Amount', amount],
    ['Stage', crm.stage || '—'],
    ['Inquiry', crm.inquiryId || '—'],
    ['Quote', crm.quoteNumber || crm.quoteId || '—'],
  ]
  return (
    <dl className="fields">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className={label === 'Amount' ? 'money' : undefined}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}
