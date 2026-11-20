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
  const discountMeta = email.discountCode && email.discountCode in DISCOUNT_CODES
    ? DISCOUNT_CODES[email.discountCode as keyof typeof DISCOUNT_CODES]
    : null
  const discountLabel = discountMeta
    ? `${discountMeta.label} discount (${(discountMeta.bps / 100).toFixed(0)}%)`
    : email.discountCode
      ? `${email.discountCode} discount`
      : null
  const period = email.billingPeriod || billingPeriodLabel({
    discountCode: email.discountCode,
    lines: lines.map((line) => ({ sku: line.sku, unit: line.unit })),
  })
  return (
    <section className="sheet quote-sheet" aria-label="Quote line items">
      <div className="sheet-top">
        <div>
          <p className="kicker">Quote preview</p>
          <h2>{email.subject || 'Quote'}</h2>
          <p className="muted">Billing: {period}{email.validUntil ? ` · Valid through ${email.validUntil}` : ''}</p>
        </div>
      </div>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <caption className="skip">Line items</caption>
          <thead>
            <tr>
              <th>Service</th>
              <th className="num">Qty</th>
              <th className="num">Unit price</th>
              <th className="num">Line total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={`${line.sku ?? 'line'}-${index}`}>
                <td>
                  {line.description || line.sku || 'Line'}
                  {line.sku ? <div className="muted mono">{line.sku}</div> : null}
                  {line.unit ? <div className="muted">Unit: {line.unit}</div> : null}
                </td>
                <td className="num">{typeof line.qty === 'number' ? line.qty.toLocaleString('en-US') : '—'}</td>
                <td className="num money">{typeof line.unitPriceCents === 'number' ? money(line.unitPriceCents) : '—'}</td>
                <td className="num money">{typeof line.lineTotalCents === 'number' ? money(line.lineTotalCents) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="totals">
        {typeof email.subtotalCents === 'number' ? (
          <div><span>Subtotal</span><span className="money">{money(email.subtotalCents)}</span></div>
        ) : null}
        {typeof email.discountCents === 'number' && email.discountCents > 0 ? (
          <div><span>{discountLabel || 'Discount'}</span><span className="money">{money(email.discountCents)}</span></div>
        ) : null}
        {typeof email.taxCents === 'number' ? (
          <div>
            <span>Tax{typeof email.taxBps === 'number' ? ` ${(email.taxBps / 100).toFixed(2)}%` : ''}</span>
            <span className="money">{money(email.taxCents)}</span>
          </div>
        ) : null}
        {typeof email.totalCents === 'number' ? (
          <div className="grand"><span>Total</span><strong className="money">{money(email.totalCents)}</strong></div>
        ) : null}
      </div>
    </section>
  )
}

function EmailPreview({ email }: { email: Email }) {
  const split = splitDeskEmail(String(email.body ?? '').replace(/\\n/g, '\n'))
  return (
    <article className="email-preview">
      <dl className="fields">
        <div><dt>To</dt><dd>{email.to}</dd></div>
        <div><dt>Subject</dt><dd>{email.subject}</dd></div>
      </dl>
      <QuoteSheet email={email} />
      <div className="email-card" aria-label="Email preview">
        <p className="kicker">Email preview</p>
        <div className="email-body">{split.main}</div>
        {split.sources.length > 0 ? (
          <>
            <h2>Sources</h2>
            <ol className="sources">
              {split.sources.map((source) => <li key={source}>{source}</li>)}
            </ol>
          </>
        ) : null}
        {split.signOff ? <p className="signoff">{split.signOff}</p> : null}
        {split.stop ? <p className="muted">To stop all contact: {maskUnsubscribeUrl(split.stop)}</p> : null}
      </div>
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
