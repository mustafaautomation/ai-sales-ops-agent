import Link from 'next/link'
import { Pill } from '../../components/ui'
import { sourceDashboard } from '../../lib/source'
import { money, when } from '../../lib/format'

export const metadata = { title: 'Overview' }

export default async function OverviewPage() {
  const data = await sourceDashboard()
  const max = Math.max(1, ...data.stages.map((stage) => stage.amountCents))
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Today</h1>
          <p className="lede">Inbound mail, quotes, and the deals waiting on an operator.</p>
        </div>
      </div>
      <section className="metrics">
        <article className="metric"><span>Open inquiries</span><strong>{data.openInquiries}</strong></article>
        <article className="metric"><span>Pending approvals</span><strong>{data.pendingApprovals}</strong></article>
        <article className="metric"><span>Quotes</span><strong>{data.quotes}</strong></article>
        <article className="metric"><span>Open pipeline</span><strong>{money(data.pipelineCents)}</strong></article>
      </section>
      <div className="grid-2">
        <section className="card">
          <h2>Recent inquiries</h2>
          {data.recentInquiries.map((inquiry) => (
            <Link key={inquiry.id} className="list-link" href={`/inbox/${inquiry.id}`}>
              <span>
                <strong>{inquiry.companyName || inquiry.fromName}</strong>
                <span className="muted"> · {inquiry.subject}</span>
              </span>
              <Pill value={inquiry.intent || inquiry.status} />
            </Link>
          ))}
        </section>
        <section className="card">
          <h2>Approval queue</h2>
          {data.queue.length === 0 ? <p className="muted">Nothing is waiting.</p> : null}
          {data.queue.map((approval) => (
            <Link key={approval.id} className="list-link" href={`/approvals/${approval.id}`}>
              <span>{approval.toolName}</span>
              <span className="muted">{when(approval.createdAt)}</span>
            </Link>
          ))}
          <h2 style={{ marginTop: 18 }}>Pipeline</h2>
          <div className="bars">
            {data.stages.map((stage) => (
              <div className="bar-row" key={stage.stage}>
                <span>{stage.stage}</span>
                <div className="track"><span style={{ width: `${(stage.amountCents / max) * 100}%` }} /></div>
                <span className="mono">{money(stage.amountCents)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
