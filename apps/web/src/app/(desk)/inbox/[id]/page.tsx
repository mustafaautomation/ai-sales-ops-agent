import { History, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ReadOnlyButton } from '../../../../components/read-only'
import { Pill } from '../../../../components/ui'
import { isDemoSession } from '../../../../lib/session'
import { rerun } from '../../actions'
import { sourceInquiries, sourceInquiry } from '../../../../lib/source'
import { relatedInquiries } from '../../../../lib/thread'
import { approvalPagePayload, approvalTitle } from '../../../../lib/approval-view'
import { ago, auditEventLabel, avatarTone, humanizeAction, initials, money, providerDisplayName, when } from '../../../../lib/format'

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

const VERDICT: Record<string, string> = {
  quote: 'The desk prices this from the rate card and holds the quote for approval.',
  product_question: 'The desk answers from the knowledge base and cites the notes it used.',
  support: 'The desk drafts a support reply for an operator to review.',
  spam: 'Archived with no reply.',
  out_of_scope: 'The desk declines politely and does not quote.',
}

const SOURCE_LABEL: Record<string, string> = { email: 'Email', web: 'Web form', voice: 'Voice line' }

function draftOf(approvals: { id: string; toolName: string; status: string; proposedJson: string; finalJson?: string | null }[]) {
  const approval = approvals.find((row) => row.toolName === 'send_email')
  if (!approval) return null
  try {
    const payload = JSON.parse(approvalPagePayload(approval.proposedJson, approval.finalJson).display) as { subject?: string; body?: string }
    if (!payload.body) return null
    return { id: approval.id, status: approval.status, subject: payload.subject ?? '', body: payload.body }
  } catch {
    return null
  }
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
  const readOnly = await isDemoSession()
  const sender = inquiry.companyName || inquiry.fromName
  const intent = classification?.intent || inquiry.intent
  const draft = draftOf(approvals)
  const thread = relatedInquiries(inquiry, await sourceInquiries())
  return (
    <>
      <div className="page-head">
        <div>
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <ol>
              <li><Link href="/inbox">Inbox</Link></li>
              <li><span aria-current="page">{sender}</span></li>
            </ol>
          </nav>
          <h1>{inquiry.subject}</h1>
          <p className="lede">{sender} · {SOURCE_LABEL[inquiry.source] ?? inquiry.source} · {when(inquiry.createdAt)}</p>
        </div>
        <div className="row-actions">
          <Pill value={inquiry.intent} />
          <Pill value={inquiry.status} />
          {runs[0] ? <Link className="btn primary" href={`/runs/${runs[0].id}`}>Open run</Link> : null}
          {readOnly ? (
            <ReadOnlyButton className="btn">Run again</ReadOnlyButton>
          ) : (
            <form action={rerun}>
              <input type="hidden" name="inquiryId" value={inquiry.id} />
              <button className="btn" type="submit">Run again</button>
            </form>
          )}
        </div>
      </div>
      {inquiry.injectionFlag ? <p className="notice warn" style={{ marginBottom: 16 }}>The body contained text that looks like an instruction to the agent. It was tagged and was not followed.</p> : null}
      <div className="reader">
        <section className="message-card letter" aria-label="Inquiry message">
          <div className="msg-head">
            <span className={`avatar lg ${avatarTone(sender)}`} aria-hidden="true">{initials(sender)}</span>
            <div>
              <strong>{inquiry.fromName}</strong>
              <span>{inquiry.companyName ? `${inquiry.companyName} · ` : ''}{ago(inquiry.createdAt)}</span>
            </div>
            <p className="kicker">Message</p>
          </div>
          <div className="message-body">{inquiry.body}</div>
        </section>
        <section className="card ai-panel">
          <span className="ai-tag"><Sparkles aria-hidden="true" />Agent read</span>
          <h2 style={{ marginTop: 10 }}>Classification</h2>
          <p className="verdict">{classificationLabel(intent, signals)}</p>
          <p className="muted">{VERDICT[intent ?? ''] ?? 'The agent has not classified this note yet.'}</p>
          {runs[0]?.summary ? <p style={{ margin: '12px 0 0', fontSize: 13.5 }}>{runs[0].summary}</p> : null}
          {draft ? (
            <div className="draft-box">
              <header>
                <strong>{draft.subject || 'Drafted reply'}</strong>
                <Pill value={draft.status} />
              </header>
              <pre>{draft.body}</pre>
            </div>
          ) : null}
        </section>
      </div>
      {thread.length > 0 ? (
        <section className="card" style={{ marginTop: 16 }} aria-label="Other inquiries from this sender">
          <div className="card-head">
            <h2><History aria-hidden="true" />Also from {sender}</h2>
            <span className="muted" style={{ fontSize: 12.5 }}>{thread.length} other {thread.length === 1 ? 'inquiry' : 'inquiries'}</span>
          </div>
          {thread.map((row) => (
            <Link key={row.id} className="list-link" href={`/inbox/${row.id}`}>
              <span className="row-text">
                <strong>{row.subject}</strong>
                <span className="muted">{row.createdAt < inquiry.createdAt ? 'Earlier' : 'Later'} · {when(row.createdAt)}</span>
              </span>
              <span className="run-meta"><Pill value={row.intent} /><Pill value={row.status} /></span>
            </Link>
          ))}
        </section>
      ) : null}
      <div className="grid-2" style={{ marginTop: 16 }}>
        <section className="card">
          <h2>Run</h2>
          {runs.length === 0 ? <p className="muted">No run yet.</p> : null}
          {runs.map((run) => (
            <Link key={run.id} className="list-link" href={`/runs/${run.id}`}>
              <span>{run.summary || providerDisplayName(run.provider)}</span>
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
              <span>{approvalTitle(approval.toolName, approval.proposedJson)}</span>
              <Pill value={approval.status} />
            </Link>
          ))}
          <h2>Audit</h2>
          {audit.length === 0 ? <p className="muted">No events yet.</p> : null}
          <ul className="feed">
            {audit.map((event) => (
              <li key={event.id} className={`actor-${String(event.actor).replace(/[^a-z]/gi, '').toLowerCase()}`}>
                <div>
                  {auditEventLabel(event) || humanizeAction(event.action)}
                  <small>{event.actor} · {when(event.at)}</small>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  )
}
