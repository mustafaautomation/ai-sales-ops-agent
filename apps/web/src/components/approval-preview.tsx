import { billingPeriodLabel, DISCOUNT_CODES } from '@meridian/core'
import { money } from '../lib/format'
import { maskPhone, maskUnsubscribeUrl } from '@meridian/core/mask'

type QuoteLine = {
  sku?: string
  description?: string
  qty?: number
  unit?: string
  unitPriceCents?: number
  lineTotalCents?: number
}

type Email = {
  to?: string
  subject?: string
  body?: string
  purpose?: string
  quoteId?: string | null
  lines?: QuoteLine[]
  subtotalCents?: number
  discountCents?: number
  taxCents?: number
  totalCents?: number
  taxBps?: number
  discountCode?: string | null
  validUntil?: string
  billingPeriod?: string
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

function QuoteSheet({ email }: { email: Email }) {
  const lines = email.lines ?? []
  if (lines.length === 0 && email.totalCents == null) return null
  const discountLabel = email.discountCode && email.discountCode in DISCOUNT_CODES
    ? DISCOUNT_CODES[email.discountCode as keyof typeof DISCOUNT_CODES].label
    : email.discountCode
  const period = email.billingPeriod || billingPeriodLabel({
    discountCode: email.discountCode,
    lines: lines.map((line) => ({ sku: line.sku, unit: line.unit })),
  })
  return (
    <section className="quote-sheet" aria-label="Quote line items">
      <h2>{email.subject || 'Quote'}</h2>
      <p className="muted">Billing: {period}{email.validUntil ? ` · Valid through ${email.validUntil}` : ''}</p>
      <table className="table">
        <thead>
          <tr>
            <th>Service</th>
            <th>Qty</th>
            <th>Unit price</th>
            <th>Line total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={`${line.sku ?? 'line'}-${index}`}>
              <td>{line.description || line.sku || 'Line'}</td>
              <td>{line.qty ?? '—'}</td>
              <td className="money">{typeof line.unitPriceCents === 'number' ? money(line.unitPriceCents) : '—'}</td>
              <td className="money">{typeof line.lineTotalCents === 'number' ? money(line.lineTotalCents) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="fields">
        {typeof email.subtotalCents === 'number' ? <div><dt>Subtotal</dt><dd className="money">{money(email.subtotalCents)}</dd></div> : null}
        {typeof email.discountCents === 'number' && email.discountCents > 0 ? (
          <div><dt>Discount{discountLabel ? ` · ${discountLabel}` : ''}</dt><dd className="money">{money(email.discountCents)}</dd></div>
        ) : null}
        {typeof email.taxCents === 'number' ? (
          <div><dt>Tax{typeof email.taxBps === 'number' ? ` (${(email.taxBps / 100).toFixed(2)}%)` : ''}</dt><dd className="money">{money(email.taxCents)}</dd></div>
        ) : null}
        {typeof email.totalCents === 'number' ? <div><dt>Total</dt><dd className="money">{money(email.totalCents)}</dd></div> : null}
      </dl>
    </section>
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
      <QuoteSheet email={email} />
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
      {stop ? <p className="muted">To stop all contact: {maskUnsubscribeUrl(stop)}</p> : null}
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
