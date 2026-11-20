import { databasePath, listSteps, migrate, openDatabase, getRun } from '@meridian/core'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
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
