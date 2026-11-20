import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Pill } from '../../../../components/ui'
import { rerun } from '../../actions'
import { sourceInquiry } from '../../../../lib/source'
import { money, when } from '../../../../lib/format'

const INTENT_LABEL: Record<string, string> = {
  quote: 'Quote request',
  product_question: 'Product question',
  support: 'Support request',
  spam: 'Spam',
  out_of_scope: 'Out of scope',
}

function classificationLabel(intent: string | null | undefined, signals: string[]): string {
  const label = INTENT_LABEL[intent ?? ''] ?? 'Not classified yet'
  const extra = signals.filter((signal) => signal !== intent && signal !== 'quote' && signal !== 'question' && signal !== 'default' && signal !== 'support')
  return extra.length > 0 ? `${label} · ${extra.join(', ')}` : label
}

export const metadata = { title: 'Inquiry' }

export default async function InquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await sourceInquiry(id)
  if (!detail) notFound()
  const { inquiry, runs } = detail
  const quotes = detail.quotes ?? []
  const deals = detail.deals ?? []
  const approvals = detail.approvals ?? []
  const audit = detail.audit ?? []
  const classification = detail.classification
  const signals = classification?.signals ?? []
  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">{inquiry.source}</p>
          <h1>{inquiry.subject}</h1>
          <p className="lede">{inquiry.companyName || inquiry.fromName} · {when(inquiry.createdAt)}</p>
        </div>
        <div className="row-actions">
          <Pill value={inquiry.intent} />
          <Pill value={inquiry.status} />
          {runs[0] ? <Link className="btn primary" href={`/runs/${runs[0].id}`}>Open run</Link> : null}
          <form action={rerun}>
            <input type="hidden" name="inquiryId" value={inquiry.id} />
            <button className="btn" type="submit">Run again</button>
          </form>
        </div>
      </div>
      {inquiry.injectionFlag ? <p className="notice warn">The body contained text that looks like an instruction to the agent. It was tagged and was not followed.</p> : null}
      <section className="card">
        <h2>Classification</h2>
        <p>{classificationLabel(classification?.intent || inquiry.intent, signals)}</p>
      </section>
      <pre className="letter">{inquiry.body}</pre>
      <div className="grid-2" style={{ marginTop: 16 }}>
        <section className="card">
          <h2>Run</h2>
          {runs.length === 0 ? <p className="muted">No run yet.</p> : null}
          {runs.map((run) => (
            <Link key={run.id} className="list-link" href={`/runs/${run.id}`}>
              <span>{run.summary || run.provider}</span>
              <Pill value={run.status} />
            </Link>
          ))}
          <h2>Quote</h2>
          {quotes.length === 0 ? <p className="muted">No quote.</p> : null}
          {quotes.map((quote) => (
            <Link key={quote.id} className="list-link" href={`/quotes/${quote.id}`}>
              <span>{quote.number}</span>
              <span className="money">{money(quote.totalCents)}</span>
            </Link>
          ))}
          <h2>CRM</h2>
          {deals.length === 0 ? <p className="muted">No deal.</p> : null}
          {deals.map((deal) => (
            <div key={deal.id} className="list-link">
              <span>{deal.title}</span>
              <span className="money">{money(deal.amountCents)} · {deal.stage}</span>
            </div>
          ))}
        </section>
        <section className="card">
          <h2>Approvals</h2>
          {approvals.length === 0 ? <p className="muted">None for this inquiry.</p> : null}
          {approvals.map((approval) => (
            <Link key={approval.id} className="list-link" href={`/approvals/${approval.id}`}>
              <span>{approval.toolName.replaceAll('_', ' ')}</span>
              <Pill value={approval.status} />
            </Link>
          ))}
          <h2>Audit</h2>
          {audit.length === 0 ? <p className="muted">No events yet.</p> : null}
          {audit.map((event) => (
            <div key={event.id} className="list-link">
              <span>{event.action}</span>
              <span className="muted">{event.actor} · {when(event.at)}</span>
            </div>
          ))}
        </section>
      </div>
    </>
  )
}
