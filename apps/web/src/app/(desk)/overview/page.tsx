import { toolLabel } from '@meridian/core'
import Link from 'next/link'
import { Pill } from '../../../components/ui'
import { sourceDashboard } from '../../../lib/source'
import { auditEventLabel, humanizeAction, money, providerDisplayName, span, when } from '../../../lib/format'

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
      {data.aiDailyLimit ? (
        <div className="banner">
          <span>AI daily limit reached, resets 08:00 MYT. Runs that hit the limit are waiting in human review.</span>
        </div>
      ) : null}
      <section className="metrics">
        <article className="metric"><span>Open inquiries</span><strong data-testid="open-inquiries-count">{data.openInquiries}</strong></article>
        <article className="metric"><span>Pending approvals</span><strong data-testid="pending-approvals-count">{data.pendingApprovals}</strong></article>
        <article className="metric"><span>Quotes</span><strong>{data.quotes}</strong></article>
        <article className="metric"><span>Open pipeline</span><strong className="money">{money(data.pipelineCents)}</strong></article>
      </section>
      <div className="grid-2">
        <section className="card">
          <h2>Open inquiries</h2>
          {data.recentInquiries.length === 0 ? <p className="muted">No open inquiries.</p> : null}
          <div data-testid="open-inquiries-list">
            {data.recentInquiries.map((inquiry) => (
              <Link key={inquiry.id} className="list-link" href={`/inbox/${inquiry.id}`}>
                <span>
                  <strong>{inquiry.companyName || inquiry.fromName}</strong>
                  <span className="muted"> · {inquiry.subject}</span>
                </span>
                <Pill value={inquiry.intent || inquiry.status} />
              </Link>
            ))}
          </div>
        </section>
        <section className="card">
          <h2>Approval queue</h2>
          {data.queue.length === 0 ? <p className="muted">Nothing is waiting.</p> : null}
          <div data-testid="approval-queue-list">
            {data.queue.map((approval) => (
              <Link key={approval.id} className="list-link" href={`/approvals/${approval.id}`}>
                <span>
                  {approvalLabel(approval.toolName, approval.companyName, approval.proposedJson)}
                  {needsAttention(approval.note) ? <span className="muted"> · Needs a follow-up</span> : null}
                </span>
                <span className="muted">{when(approval.createdAt)}</span>
              </Link>
            ))}
          </div>
          <h2 style={{ marginTop: 18 }}>Pipeline</h2>
          <div className="bars">
            {data.stages.map((stage) => (
              <div className="bar-row" key={stage.stage}>
                <span>{stage.stage.charAt(0).toUpperCase() + stage.stage.slice(1)}</span>
                <div className="track"><span style={{ width: `${(stage.amountCents / max) * 100}%` }} /></div>
                <span className="money">{money(stage.amountCents)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="grid-2" style={{ marginTop: 16 }}>
        <section className="card">
          <h2>Recent runs</h2>
          {(data.recentRuns ?? []).length === 0 ? <p className="muted">No runs yet.</p> : null}
          {(data.recentRuns ?? []).map((run) => (
            <Link key={run.id} className="list-link" href={`/runs/${run.id}`}>
              <span>
                <strong>{run.companyName || run.fromName || 'Run'}</strong>
                <span className="muted"> · {providerDisplayName(run.provider)}</span>
              </span>
              <span className="muted">{runTimingLabel(run)}</span>
            </Link>
          ))}
          <p style={{ marginTop: 12 }}><Link href="/runs">View all runs</Link></p>
        </section>
        <section className="card">
          <h2>Activity</h2>
          {(data.activity ?? []).length === 0 ? <p className="muted">No audit events yet.</p> : null}
          {(data.activity ?? []).map((event) => (
            <div key={event.id} className="list-link">
              <span>{auditEventLabel(event) || humanizeAction(String(event.action))}</span>
              <span className="muted">{event.actor} · {when(event.at)}</span>
            </div>
          ))}
        </section>
      </div>
    </>
  )
}

function approvalLabel(tool: string, company?: string | null, proposedJson?: string | null): string {
  let name = toolLabel(tool)
  if (tool === 'send_email') {
    name = proposedJson?.includes('"purpose":"quote"') || proposedJson?.includes('"quote"') ? 'Send quote email' : 'Send email'
  }
  return company ? `${name} · ${company}` : name
}

function needsAttention(note?: string | null): boolean {
  return /follow-up/i.test(note ?? '')
}

function runTimingLabel(run: { status: string; startedAt?: number | null; finishedAt?: number | null; agentMs?: number | null }): string {
  const agent = run.agentMs && run.agentMs > 0 ? span(run.agentMs) : null
  const total = run.startedAt && run.finishedAt && run.finishedAt >= run.startedAt ? run.finishedAt - run.startedAt : 0
  const wait = agent && total > (run.agentMs ?? 0) + 1000 ? total - (run.agentMs ?? 0) : 0
  const waitLabel = wait > 1000 ? span(wait) : null
  if (agent && waitLabel) return `${agent} · waited ${waitLabel}`
  if (agent) return agent
  return statusWords(run.status)
}

function statusWords(status: string): string {
  const words = status.replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}
