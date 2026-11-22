import { toolLabel } from '@meridian/core'
import { Activity, Bot, CircleDollarSign, FileText, Inbox, PieChart, ShieldCheck, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { Pill } from '../../../components/ui'
import { sourceDashboard, sourceInquiries } from '../../../lib/source'
import { ago, auditEventLabel, avatarTone, humanizeAction, initials, money, providerDisplayName, span, statusLabel } from '../../../lib/format'

export const metadata = { title: 'Overview' }

const INTENTS = ['quote', 'product_question', 'support', 'out_of_scope', 'spam'] as const
const RING = 2 * Math.PI * 52

export default async function OverviewPage() {
  const [data, inquiries] = await Promise.all([sourceDashboard(), sourceInquiries()])
  const max = Math.max(1, ...data.stages.map((stage) => stage.amountCents))
  const mix: { intent: string; count: number }[] = INTENTS.map((intent) => ({ intent: intent as string, count: inquiries.filter((row) => row.intent === intent).length })).filter((row) => row.count > 0)
  const unclassified = inquiries.length - mix.reduce((sum, row) => sum + row.count, 0)
  if (unclassified > 0) mix.push({ intent: 'other', count: unclassified })
  const total = Math.max(1, inquiries.length)
  const handled = inquiries.filter((row) => row.status === 'resolved' || row.status === 'archived').length
  const won = data.stages.find((stage) => stage.stage === 'won')
  const openDeals = data.stages.filter((stage) => ['lead', 'qualified', 'proposal'].includes(stage.stage)).reduce((sum, stage) => sum + stage.count, 0)
  let offset = 0
  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">{new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: process.env.CALL_WINDOW_TZ || 'Asia/Kuala_Lumpur' }).format(new Date())}</p>
          <h1>Today</h1>
          <p className="lede">Inbound mail, quotes, and the deals waiting on an operator.</p>
        </div>
        <div className="row-actions">
          <Link className="btn" href="/inbox">Open inbox</Link>
          <Link className="btn primary" href="/approvals">Review approvals</Link>
        </div>
      </div>
      {data.aiDailyLimit ? (
        <div className="banner">
          <span>AI daily limit reached, resets 08:00 MYT. Runs that hit the limit are waiting in human review.</span>
        </div>
      ) : null}
      <section className="metrics">
        <article className="metric">
          <span className="metric-label"><span className="metric-ico"><Inbox aria-hidden="true" /></span>Open inquiries</span>
          <strong data-testid="open-inquiries-count">{data.openInquiries}</strong>
          <span className="metric-foot"><b>{handled}</b> of {inquiries.length} handled</span>
        </article>
        <article className="metric tone-warn">
          <span className="metric-label"><span className="metric-ico"><ShieldCheck aria-hidden="true" /></span>Pending approvals</span>
          <strong data-testid="pending-approvals-count">{data.pendingApprovals}</strong>
          <span className="metric-foot">{data.pendingApprovals > 0 ? 'Held until an operator decides' : 'Nothing is waiting'}</span>
        </article>
        <article className="metric tone-info">
          <span className="metric-label"><span className="metric-ico"><FileText aria-hidden="true" /></span>Quotes</span>
          <strong>{data.quotes}</strong>
          <span className="metric-foot"><b>{data.sentQuotes ?? 0}</b> sent after approval</span>
        </article>
        <article className="metric tone-violet">
          <span className="metric-label"><span className="metric-ico"><CircleDollarSign aria-hidden="true" /></span>Open pipeline</span>
          <strong className="money">{money(data.pipelineCents)}</strong>
          <span className="metric-foot"><b>{openDeals}</b> open {openDeals === 1 ? 'deal' : 'deals'}{won && won.amountCents > 0 ? ` · ${money(won.amountCents)} won` : ''}</span>
        </article>
      </section>
      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2><Inbox aria-hidden="true" />Open inquiries</h2>
            <Link href="/inbox">View inbox</Link>
          </div>
          {data.recentInquiries.length === 0 ? <p className="muted">No open inquiries.</p> : null}
          <div data-testid="open-inquiries-list">
            {data.recentInquiries.map((inquiry) => {
              const name = inquiry.companyName || inquiry.fromName
              return (
                <Link key={inquiry.id} className="list-link" href={`/inbox/${inquiry.id}`}>
                  <span className="row-main">
                    <span className={`avatar ${avatarTone(name)}`} aria-hidden="true">{initials(name)}</span>
                    <span className="row-text">
                      <strong>{name}</strong>
                      <span className="muted">{inquiry.subject}</span>
                    </span>
                  </span>
                  <Pill value={inquiry.intent || inquiry.status} />
                </Link>
              )
            })}
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h2><ShieldCheck aria-hidden="true" />Approval queue</h2>
            <Link href="/approvals">View all</Link>
          </div>
          {data.queue.length === 0 ? <p className="muted">Nothing is waiting.</p> : null}
          <div data-testid="approval-queue-list">
            {data.queue.map((approval) => (
              <Link key={approval.id} className="list-link" href={`/approvals/${approval.id}`}>
                <span>
                  {approvalLabel(approval.toolName, approval.companyName, approval.proposedJson)}
                  {needsAttention(approval.note) ? <span className="muted"> · Needs a follow-up</span> : null}
                </span>
                <span className="muted run-meta">{ago(approval.createdAt)}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
      <div className="grid-2" style={{ marginTop: 16 }}>
        <section className="card">
          <div className="card-head">
            <h2><TrendingUp aria-hidden="true" />Pipeline</h2>
            <Link href="/crm">Open CRM</Link>
          </div>
          <div className="bars">
            {data.stages.map((stage) => (
              <div className={`bar-row stage-${stage.stage}`} key={stage.stage}>
                <span>{stage.stage.charAt(0).toUpperCase() + stage.stage.slice(1)}</span>
                <div className="track"><span style={{ width: `${(stage.amountCents / max) * 100}%` }} /></div>
                <span className="money">{money(stage.amountCents)}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h2><PieChart aria-hidden="true" />Inquiry mix</h2>
          </div>
          {inquiries.length === 0 ? <p className="muted">No inquiries yet.</p> : (
            <div className="donut-wrap">
              <div className="donut" role="img" aria-label={`Inquiry mix: ${mix.map((row) => `${row.count} ${row.intent === 'other' ? 'not classified' : statusLabel(row.intent).toLowerCase()}`).join(', ')}`}>
                <svg viewBox="0 0 120 120">
                  <circle className="ring-bg" cx="60" cy="60" r="52" />
                  {mix.map((row) => {
                    const length = (row.count / total) * RING
                    const gap = mix.length > 1 ? 2 : 0
                    const dash = `${Math.max(0, length - gap)} ${RING - Math.max(0, length - gap)}`
                    const node = <circle key={row.intent} className={`c-${row.intent}`} cx="60" cy="60" r="52" strokeDasharray={dash} strokeDashoffset={-offset} />
                    offset += length
                    return node
                  })}
                </svg>
                <div className="donut-center"><strong>{inquiries.length}</strong><span>inquiries</span></div>
              </div>
              <ul className="legend">
                {mix.map((row) => (
                  <li key={row.intent}><i className={`c-${row.intent}`} /><span>{row.intent === 'other' ? 'Not classified' : statusLabel(row.intent)}</span><b>{row.count}</b></li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
      <div className="grid-2" style={{ marginTop: 16 }}>
        <section className="card">
          <div className="card-head">
            <h2><Bot aria-hidden="true" />Recent runs</h2>
            <Link href="/runs">View all runs</Link>
          </div>
          {(data.recentRuns ?? []).length === 0 ? <p className="muted">No runs yet.</p> : null}
          {(data.recentRuns ?? []).map((run) => {
            const duration = runDurationLabel(run)
            return (
              <Link key={run.id} className="list-link" href={`/runs/${run.id}`}>
                <span className="row-text">
                  <strong>{run.companyName || run.fromName || 'Run'}</strong>
                  <span className="muted">{providerDisplayName(run.provider)}{duration ? ` · ${duration}` : ''}</span>
                </span>
                <span className="run-meta">
                  <Pill value={run.status} />
                </span>
              </Link>
            )
          })}
        </section>
        <section className="card">
          <div className="card-head">
            <h2><Activity aria-hidden="true" />Activity</h2>
            <Link href="/audit">Audit log</Link>
          </div>
          {(data.activity ?? []).length === 0 ? <p className="muted">No audit events yet.</p> : null}
          <ul className="feed">
            {(data.activity ?? []).map((event) => (
              <li key={event.id} className={`actor-${String(event.actor).replace(/[^a-z]/gi, '').toLowerCase()}`}>
                <div>
                  {auditEventLabel(event) || humanizeAction(String(event.action))}
                  <small>{event.actor} · {ago(event.at)}</small>
                </div>
              </li>
            ))}
          </ul>
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

function runDurationLabel(run: { startedAt?: number | null; finishedAt?: number | null; agentMs?: number | null }): string | null {
  const agent = run.agentMs && run.agentMs > 0 ? span(run.agentMs) : null
  const total = run.startedAt && run.finishedAt && run.finishedAt >= run.startedAt ? run.finishedAt - run.startedAt : 0
  const wait = agent && total > (run.agentMs ?? 0) + 1000 ? total - (run.agentMs ?? 0) : 0
  const waitLabel = wait > 1000 ? span(wait) : null
  if (agent && waitLabel) return `${agent} · waited ${waitLabel}`
  if (agent) return agent
  return null
}
