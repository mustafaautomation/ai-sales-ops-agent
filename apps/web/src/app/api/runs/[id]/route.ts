import { databasePath, listSteps, migrate, openDatabase, getRun } from '@meridian/core'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (process.env.WORKER_URL) {
    const headers = { authorization: `Bearer ${process.env.WORKER_AUTH_TOKEN ?? ''}` }
    const load = async () => {
      const response = await fetch(`${process.env.WORKER_URL}/api/runs/${id}`, { headers, cache: 'no-store' })
      if (!response.ok) return null
      return response.json() as Promise<{
        run: { status: string; inquiryId: string }
        steps: { id: string; toolName: string | null; status: string; redactedResultJson: string | null }[]
      }>
    }
    let payload = await load()
    if (!payload) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (payload.run.status === 'running') {
      await fetch(`${process.env.WORKER_URL}/api/inquiries/${payload.run.inquiryId}/step`, { method: 'POST', headers })
      payload = (await load()) ?? payload
    }
    return NextResponse.json({
      status: payload.run.status,
      steps: payload.steps.map((step) => ({
        id: step.id,
        toolName: step.toolName,
        status: step.status,
        redactedResultJson: step.redactedResultJson,
      })),
    })
  }
  const db = openDatabase(databasePath())
  migrate(db)
  const run = getRun(db, id)
  if (!run) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const steps = listSteps(db, id).map((step) => ({
    id: step.id,
    toolName: step.toolName,
    status: step.status,
    redactedResultJson: step.redactedResultJson,
  }))
  return NextResponse.json({ status: run.status, steps })
}
