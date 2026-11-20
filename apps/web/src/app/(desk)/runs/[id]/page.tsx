import { modelLabel, runProvidersLabel, toolLabel } from '@meridian/core'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LiveRun } from '../../../../components/live-run'
import { EmptyState, JsonBlock, PageHeader, Pill } from '../../../../components/ui'
import { deskWhen, readStepResult, stepTiming } from '../../../../lib/format'
import { sourceRun } from '../../../../lib/source'

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
  return modelLabel(model)
}

function attemptLine(step: Step): { line: string; detail: string } | null {
  const result = readStepResult(step.redactedResultJson)
  const attempts = result.attempts ?? []
  if (attempts.length === 0) return null
  const failed = attempts.map((attempt) => `${shortModel(attempt.model)}: ${attempt.reason || attempt.outcome}`).join('; ')
  const next = step.model ? shortModel(step.model) : result.fallback ? 'the desk rules' : null
  const line = next ? `${failed}, retried on ${next}` : failed
  const detail = attempts.filter((attempt) => attempt.detail && attempt.detail !== attempt.reason).map((attempt) => attempt.detail).join('\n\n')
  return { line, detail }
}

export const metadata = { title: 'Run' }

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const { id } = await params
  const query = await searchParams
  const snapshot = await sourceRun(id)
  if (!snapshot?.inquiry) notFound()
  const steps = snapshot.steps as Step[]
  const providers = runProvidersLabel(steps.map((step) => step.model), snapshot.run.provider)
  const waiting = snapshot.run.status === 'awaiting_approval' && snapshot.pending
  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Overview', href: '/overview' },
          { label: 'Run' },
        ]}
        kicker={`${providers} · ${deskWhen(snapshot.run.startedAt)}`}
        title={snapshot.inquiry.subject}
        description={snapshot.run.summary || snapshot.run.error || (waiting ? 'Waiting for approval.' : 'The run is in progress.')}
        actions={(
          <>
            <Pill value={snapshot.run.status} />
            {snapshot.run.disposition && snapshot.run.disposition.replaceAll('_', ' ').toLowerCase() !== snapshot.run.status.replaceAll('_', ' ').toLowerCase() ? (
              <Pill value={snapshot.run.disposition} />
            ) : null}
          </>
        )}
      />
      {query.notice ? <p className="notice">Decision recorded: {query.notice}.</p> : null}
      <LiveRun runId={snapshot.run.id} initialStatus={snapshot.run.status} />
      {snapshot.pending ? (
        <div className="banner">
          <span>Waiting on approval for <strong>{toolLabel(String(snapshot.pending.toolName))}</strong>. The tool has not run.</span>
          <Link className="btn primary" href={`/approvals/${snapshot.pending.id}`}>Review approval</Link>
        </div>
      ) : null}
      <p className="muted">Logged arguments and results are redacted. Step names, status, timing, and provider/model stay visible.</p>
      {steps.length === 0 ? (
        <EmptyState title="No steps yet" description="This run has not recorded a step timeline." />
      ) : (
        <div className="timeline">
          {steps.map((step, index) => {
            const result = readStepResult(step.redactedResultJson)
            const fallback = step.toolName === 'desk_fallback' || result.fallback === true
            const retry = (result.attempts?.length ?? 0) > 0
            const model = step.model ? shortModel(step.model) : ''
            const timing = stepTiming(step)
            const attempt = attemptLine(step)
            return (
              <article key={step.id} className={`t-item ${step.status}`} data-tool={step.toolName ?? undefined}>
                <div className="rail">
                  <div className="dot" />
                  {index < steps.length - 1 ? <div className="stem" /> : null}
                </div>
                <div className="t-card">
                  <header>
                    <div className="step-name">
                      <strong>{toolLabel(step.toolName)}</strong>
                      {fallback ? <span className="chip fallback">Rule-based fallback</span> : null}
                      {!fallback && model ? <span className="chip model">{model}</span> : null}
                      {retry ? <span className="chip retry">Retried</span> : null}
                      {timing.own ? <span className="chip time">{timing.own}</span> : null}
                    </div>
                    <Pill value={step.status} />
                  </header>
                  {attempt ? <p className="muted attempt">{attempt.line}</p> : null}
                  {attempt?.detail ? (
                    <details className="payload">
                      <summary>Validation detail</summary>
                      <pre className="json">{attempt.detail}</pre>
                    </details>
                  ) : null}
                  {timing.wait ? <p className="muted attempt">waited {timing.wait} for approval</p> : null}
                  <JsonBlock value={step.redactedArgsJson} label="Arguments" />
                  <JsonBlock value={step.redactedResultJson} label="Result" />
                </div>
              </article>
            )
          })}
        </div>
      )}
    </>
  )
}
