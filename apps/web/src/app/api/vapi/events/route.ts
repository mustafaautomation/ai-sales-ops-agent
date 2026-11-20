import { databasePath, insertCall, migrate, openDatabase, secretsMatch } from '@meridian/core'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const secret = process.env.VAPI_SECRET || 'local-vapi-secret'
  const provided = request.headers.get('x-vapi-secret') ?? ''
  if (!(await secretsMatch(provided, secret))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = (await request.json()) as { message?: { summary?: string; type?: string; endedReason?: string; transcript?: unknown; call?: { id?: string; customer?: { name?: string } } }; summary?: string; callId?: string; company?: string; callerName?: string; inquiryId?: string }
  const message = body.message
  const db = openDatabase(databasePath())
  migrate(db)
  const row = insertCall(db, {
    vapiCallId: message?.call?.id ?? body.callId ?? null,
    callerName: body.callerName ?? message?.call?.customer?.name ?? null,
    companyName: body.company ?? null,
    inquiryId: body.inquiryId ?? null,
    status: message?.type ?? 'end-of-call-report',
    summary: message?.summary ?? body.summary ?? null,
    transcript: typeof message?.transcript === 'string'
      ? message.transcript.replace(/\\n/g, '\n')
      : message?.transcript == null
        ? null
        : JSON.stringify(message.transcript),
    outcome: message?.endedReason ?? 'completed',
  })
  return NextResponse.json({ id: row.id })
}
