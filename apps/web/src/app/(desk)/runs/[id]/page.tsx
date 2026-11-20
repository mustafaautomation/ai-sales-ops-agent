import { LiveRun } from '../../../../components/live-run'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { JsonBlock, Pill } from '../../../../components/ui'
import { sourceRun } from '../../../../lib/source'
import { stepTiming, when } from '../../../../lib/format'

type Step = {
  id: string
  toolName: string | null
  model: string | null
  status: string
  createdAt: number
  startedAt?: number | null
  finishedAt?: number | null
  approvalDecidedAt?: number | null
  approvalId?: string | null
  redactedArgsJson: string | null
  redactedResultJson: string | null
}

function shortModel(model: string): string {
  return model.split('/').pop() ?? model
}

function readResult(step: Step): { fallback?: boolean; attempts?: { model: string; outcome: string; reason: string }[] } {
  if (!step.redactedResultJson) return {}
  try {
    return JSON.parse(step.redactedResultJson) as { fallback?: boolean; attempts?: { model: string; outcome: string; reason: string }[] }
  } catch {
    return {}
  }
}

function attemptLine(step: Step): string | null {
  const attempts = readResult(step).attempts ?? []
  if (attempts.length === 0) return null
  const failed = attempts.map((attempt) => `${shortModel(attempt.model)}: ${attempt.reason || attempt.outcome}`).join('; ')
  const next = step.model ? shortModel(step.model) : readResult(step).fallback ? 'the desk rules' : null
  return next ? `${failed}, retried on ${next}` : failed
}

export const metadata = { title: 'Run' }

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const { id } = await params
  const query = await searchParams
  const snapshot = await sourceRun(id)
  if (!snapshot?.inquiry) notFound()
  const steps = snapshot.steps as Step[]
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
      <p className="muted">Logged arguments and results are redacted.</p>
      <div className="timeline">
        {steps.map((step, index) => {
          const result = readResult(step)
          const fallback = step.toolName === 'desk_fallback' || result.fallback === true
          const retry = (result.attempts?.length ?? 0) > 0
          const model = step.model ? shortModel(step.model) : ''
          const timing = stepTiming(step)
          const attempt = attemptLine(step)
          return (
            <article key={step.id} className={`t-item ${step.status}`}>
              <div className="rail">
                <div className="dot" />
                {index < steps.length - 1 ? <div className="stem" /> : null}
              </div>
              <div className="t-card">
                <header>
                  <div className="step-name">
                    <strong>{step.toolName}</strong>
                    {fallback ? <span className="chip fallback">Rule-based fallback</span> : null}
                    {!fallback && model ? <span className="chip model">{model}</span> : null}
                    {retry ? <span className="chip retry">Retried</span> : null}
                    {timing.own ? <span className="chip time">{timing.own}</span> : null}
                  </div>
                  <Pill value={step.status} />
                </header>
                {attempt ? <p className="muted attempt">{attempt}</p> : null}
                {timing.wait ? <p className="muted attempt">waited {timing.wait} for approval</p> : null}
                <JsonBlock value={step.redactedArgsJson} label="Arguments" />
                <JsonBlock value={step.redactedResultJson} label="Result" />
              </div>
            </article>
          )
        })}
      </div>
    </>
  )
}
