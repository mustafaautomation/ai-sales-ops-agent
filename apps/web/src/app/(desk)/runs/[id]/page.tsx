import { LiveRun } from '../../../../components/live-run'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { JsonBlock, Pill } from '../../../../components/ui'
import { sourceRun } from '../../../../lib/source'
import { when } from '../../../../lib/format'

function stepLabel(step: { toolName: string | null; model: string | null; redactedResultJson: string | null }): string {
  if (step.toolName === 'desk_fallback' || step.redactedResultJson?.includes('"fallback":true')) return 'Rule-based fallback'
  if (!step.model) return ''
  return step.model.split('/').pop() ?? step.model
}

export const metadata = { title: 'Run' }

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const { id } = await params
  const query = await searchParams
  const snapshot = await sourceRun(id)
  if (!snapshot?.inquiry) notFound()
  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">{snapshot.run.provider} · {when(snapshot.run.startedAt)}</p>
          <h1>{snapshot.inquiry.subject}</h1>
          <p className="lede">{snapshot.run.summary || snapshot.run.error || 'The run is in progress.'}</p>
        </div>
        <div className="row-actions">
          <Pill value={snapshot.run.status} />
          {snapshot.run.disposition && snapshot.run.disposition.replaceAll('_', ' ').toLowerCase() !== snapshot.run.status.replaceAll('_', ' ').toLowerCase() ? <Pill value={snapshot.run.disposition} /> : null}
        </div>
      </div>
      {query.notice ? <p className="notice">Decision recorded: {query.notice}.</p> : null}
      <LiveRun runId={snapshot.run.id} initialStatus={snapshot.run.status} />
      {snapshot.pending ? (
        <div className="banner">
          <span>Waiting on approval for <strong>{snapshot.pending.toolName}</strong>. The tool has not run.</span>
          <Link className="btn primary" href={`/approvals/${snapshot.pending.id}`}>Review approval</Link>
        </div>
      ) : null}
      <div className="timeline">
        {snapshot.steps.map((step, index) => (
          <article key={step.id} className={`t-item ${step.status}`}>
            <div className="rail">
              <div className="dot" />
              {index < snapshot.steps.length - 1 ? <div className="stem" /> : null}
            </div>
            <div className="t-card">
              <header>
                <strong>{step.toolName}</strong>
                {stepLabel(step) ? <span className="muted">{stepLabel(step)}</span> : null}
                <Pill value={step.status} />
              </header>
              <p className="muted">Logged arguments and results are redacted.</p>
              <JsonBlock value={step.redactedArgsJson} />
              <JsonBlock value={step.redactedResultJson} />
            </div>
          </article>
        ))}
      </div>
    </>
  )
}
