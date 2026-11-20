import { money } from '../lib/format'

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

const QUOTE_LINE = /^(\d[\d,]*)\s×\s(.+?)\s\(([^)]+)\)\s@\s(\$[\d,.]+)\s=\s(\$[\d,.]+)$/
const TOTAL_LINE = /^(Subtotal|Discount(?: \([^)]+\))?|Tax(?: \([^)]+\))?|Total):\s*(\$[\d,.]+)$/

function parsed(value: string): Record<string, unknown> | null {
  try {
    const data = JSON.parse(value) as unknown
    return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null
  } catch {
    return null
  }
}

export function ApprovalPreview({ tool, payload }: { tool: string; payload: string }) {
  const data = parsed(payload)
  if (!data) return <pre className="json">{payload}</pre>
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
  const body = String(email.body ?? '').replace(/\\n/g, '\n')
  const sourceAt = body.search(/\nSources:\n/)
  const main = sourceAt >= 0 ? body.slice(0, sourceAt).trim() : body.trim()
  const sources = sourceAt >= 0
    ? body.slice(sourceAt).replace(/^Sources:\n?/, '').split('\n').map((line) => line.replace(/^\d+\.\s*/, '').trim()).filter(Boolean)
    : []
  const lines = main.split('\n')
  const items = lines.flatMap((line) => {
    const match = line.match(QUOTE_LINE)
    return match ? [{ qty: match[1], description: match[2], sku: match[3], unit: match[4], total: match[5] }] : []
  })
  const totals = lines.flatMap((line) => {
    const match = line.match(TOTAL_LINE)
    return match ? [{ label: match[1], amount: match[2] }] : []
  })
  const prose = lines.filter((line) => line.trim() && !QUOTE_LINE.test(line) && !TOTAL_LINE.test(line)).join('\n')
  return (
    <article className="email-preview">
      <dl className="fields">
        <div><dt>To</dt><dd>{email.to}</dd></div>
        <div><dt>Subject</dt><dd>{email.subject}</dd></div>
      </dl>
      <div className="email-body">{prose}</div>
      {items.length > 0 ? (
        <table className="quote-table">
          <caption>Quote lines</caption>
          <thead>
            <tr><th>Qty</th><th>Item</th><th>SKU</th><th className="num">Unit</th><th className="num">Line</th></tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${item.sku}-${item.qty}`}>
                <td className="num">{item.qty}</td>
                <td>{item.description}</td>
                <td className="mono">{item.sku}</td>
                <td className="num money">{item.unit}</td>
                <td className="num money">{item.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {totals.length > 0 ? (
        <div className="totals">
          {totals.map((row) => (
            <div key={row.label} className={row.label === 'Total' ? 'grand' : undefined}>
              <span>{row.label}</span>
              <span className="money">{row.amount}</span>
            </div>
          ))}
        </div>
      ) : null}
      {sources.length > 0 ? (
        <>
          <h2>Sources</h2>
          <ul className="sources">
            {sources.map((source) => <li key={source}>{source}</li>)}
          </ul>
        </>
      ) : null}
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
