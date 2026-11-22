import { billingPeriodLabel, CATALOG, DISCOUNT_CODES } from '@meridian/core'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LogoMark } from '../../../../components/logo'
import { Pill } from '../../../../components/ui'
import { sourceQuote } from '../../../../lib/source'
import { money } from '../../../../lib/format'

export const metadata = { title: 'Quote' }

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await sourceQuote(id)
  if (!detail) notFound()
  const { quote, lines } = detail
  const discount = quote.discountCode && quote.discountCode in DISCOUNT_CODES
    ? DISCOUNT_CODES[quote.discountCode as keyof typeof DISCOUNT_CODES].label
    : 'None'
  const title = lines[0]?.description ? `Quote ${quote.number}: ${lines[0].description}` : `Quote ${quote.number}`
  const period = billingPeriodLabel({
    discountCode: quote.discountCode,
    lines: lines.map((line) => ({
      sku: line.sku,
      unit: CATALOG.find((item) => item.sku === line.sku)?.unit,
    })),
  })
  return (
    <>
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        <li><Link href="/quotes">Quotes</Link></li>
        <li><span aria-current="page">{quote.number}</span></li>
      </ol>
    </nav>
    <article className="sheet">
      <div className="sheet-top">
        <div>
          <div className="auth-brand" style={{ marginBottom: 14 }}><LogoMark /><span className="kicker">Meridian Facilities · Cedarhaven</span></div>
          <h1>{title}</h1>
          <p>{quote.companyName}</p>
          <p className="muted">{quote.contactName}</p>
          <p className="muted">Billing: {period}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <Pill value={quote.status} />
          <p className="muted" style={{ marginBottom: 0 }}>Valid through</p>
          <p style={{ margin: 0, fontWeight: 600 }}>{quote.validUntil}</p>
        </div>
      </div>
      <div className="table-wrap" style={{ marginTop: 18 }}>
        <table>
          <caption className="skip">Line items</caption>
          <thead>
            <tr><th>Service</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Line total</th></tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                <td>{line.description}<div className="muted mono">{line.sku}</div></td>
                <td className="num">{line.qty.toLocaleString('en-US')}</td>
                <td className="num money">{money(line.unitPriceCents)}</td>
                <td className="num money">{money(line.lineTotalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="totals">
        <div><span>Subtotal</span><span className="money">{money(quote.subtotalCents)}</span></div>
        <div><span>Discount · {discount}</span><span className="money">{money(quote.discountCents)}</span></div>
        <div><span>Tax {(quote.taxBps / 100).toFixed(2)}%</span><span className="money">{money(quote.taxCents)}</span></div>
        <div className="grand"><span>Total</span><strong className="money">{money(quote.totalCents)}</strong></div>
      </div>
      {quote.notes ? <p className="muted">{quote.notes}</p> : null}
    </article>
    </>
  )
}
