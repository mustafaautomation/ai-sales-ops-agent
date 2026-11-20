import { insertCall, migrate, openDatabase, databasePath, verifyDeskToken } from '@meridian/core'
import { NextResponse } from 'next/server'
import { sessionSecret } from '../../../../lib/token'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const body = (await request.json()) as { token?: string; vapiCallId?: string; ended?: boolean; endedAt?: number }
  const token = String(body.token ?? '')
  const vapiCallId = String(body.vapiCallId ?? '')
  if (process.env.WORKER_URL) {
    const path = body.ended ? '/api/public/call-ended' : '/api/public/call-started'
    const response = await fetch(`${process.env.WORKER_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, vapiCallId, endedAt: body.endedAt }),
      cache: 'no-store',
    })
    const text = await response.text()
    return new NextResponse(text, { status: response.status, headers: { 'content-type': 'application/json' } })
  }
  const checked = await verifyDeskToken(sessionSecret(), token)
  if (!checked.ok || checked.payload.purpose !== 'call') {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const db = openDatabase(databasePath())
  migrate(db)
  const inquiry = db.$client.prepare('SELECT id, from_name, company_name, subject, suppressed_at FROM inquiries WHERE id = ?').get(checked.payload.inquiryId) as { id: string; from_name: string; company_name: string | null; subject: string; suppressed_at: number | null } | undefined
  if (!inquiry || inquiry.suppressed_at) return NextResponse.json({ ok: false }, { status: 400 })
  const at = typeof body.endedAt === 'number' && body.endedAt > 0 ? body.endedAt : Date.now()
  if (body.ended) {
    if (vapiCallId) {
      const existing = db.$client.prepare('SELECT id, ended_at FROM calls WHERE vapi_call_id = ?').get(vapiCallId) as { id: string; ended_at: number | null } | undefined
      if (existing && !existing.ended_at) {
        db.$client.prepare(`UPDATE calls SET status = 'ended', ended_at = ? WHERE id = ?`).run(at, existing.id)
      }
      db.$client.prepare(
        `UPDATE outbound_calls SET status = 'completed', vapi_call_id = COALESCE(vapi_call_id, ?), ended_at = COALESCE(ended_at, ?)
         WHERE inquiry_id = ? AND mode = 'browser'`,
      ).run(vapiCallId, at, inquiry.id)
    } else {
      db.$client.prepare(
        `UPDATE outbound_calls SET status = 'completed', ended_at = COALESCE(ended_at, ?) WHERE inquiry_id = ? AND mode = 'browser'`,
      ).run(at, inquiry.id)
    }
    return NextResponse.json({ ok: true, inquiryId: inquiry.id })
  }
  if (!vapiCallId) return NextResponse.json({ ok: false }, { status: 400 })
  db.$client.prepare(
    `UPDATE outbound_calls SET vapi_call_id = ?, status = CASE WHEN status IN ('completed', 'ended') THEN status ELSE 'started' END, started_at = COALESCE(started_at, ?)
     WHERE inquiry_id = ? AND mode = 'browser' AND (vapi_call_id IS NULL OR vapi_call_id = ?)`,
  ).run(vapiCallId, at, inquiry.id, vapiCallId)
  const existing = db.$client.prepare('SELECT id FROM calls WHERE vapi_call_id = ?').get(vapiCallId) as { id: string } | undefined
  if (existing) {
    db.$client.prepare('UPDATE calls SET inquiry_id = ?, caller_name = ?, company_name = ?, summary = COALESCE(summary, ?) WHERE id = ?').run(
      inquiry.id, inquiry.from_name, inquiry.company_name, inquiry.subject, existing.id,
    )
    return NextResponse.json({ ok: true, id: existing.id, inquiryId: inquiry.id })
  }
  const row = insertCall(db, {
    vapiCallId,
    callerName: inquiry.from_name,
    companyName: inquiry.company_name,
    inquiryId: inquiry.id,
    status: 'in-progress',
    summary: inquiry.subject,
    startedAt: at,
  })
  return NextResponse.json({ ok: true, id: row.id, inquiryId: inquiry.id })
}
