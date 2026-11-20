'use client'

import { useEffect, useState } from 'react'

type Step = { id: string; toolName: string | null; status: string; redactedResultJson: string | null }
type Payload = { status: string; steps: Step[] }

export function LiveRun({ runId, initialStatus }: { runId: string; initialStatus: string }) {
  const [status, setStatus] = useState(initialStatus)
  const [steps, setSteps] = useState<Step[] | null>(null)

  useEffect(() => {
    if (status !== 'running' && status !== 'processing') return
    let stop = false
    const tick = async () => {
      const response = await fetch(`/api/runs/${runId}`)
      if (!response.ok || stop) return
      const payload = (await response.json()) as Payload
      setStatus(payload.status)
      setSteps(payload.steps)
    }
    const timer = setInterval(() => void tick(), 800)
    void tick()
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [runId, status])

  if (!steps) return status === 'running' ? <p className="notice">The agent is working through the note.</p> : null
  return (
    <div className="stack">
      <p className="notice">The agent is working through the note.</p>
      {steps.map((step) => (
        <article key={step.id} className="t-card">
          <header>
            <strong>{step.toolName}</strong>
            <span className={`pill ${step.status}`}>{step.status.replaceAll('_', ' ')}</span>
          </header>
        </article>
      ))}
    </div>
  )
}
