import { insertCall, migrate, openDatabase, databasePath, verifyDeskToken } from '@meridian/core'
import { NextResponse } from 'next/server'
import { sessionSecret } from '../../../../lib/token'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const body = (await request.json()) as { token?: string; vapiCallId?: string }
  const token = String(body.token ?? '')
  const vapiCallId = String(body.vapiCallId ?? '')
  if (process.env.WORKER_URL) {
    const response = await fetch(`${process.env.WORKER_URL}/api/public/call-started`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, vapiCallId }),
      cache: 'no-store',
    })
    const text = await response.text()
    return new NextResponse(text, { status: response.status, headers: { 'content-type': 'application/json' } })
  }
  const checked = await verifyDeskToken(sessionSecret(), token)
  if (!checked.ok || checked.payload.purpose !== 'call' || !vapiCallId) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const db = openDatabase(databasePath())
  migrate(db)
  const inquiry = db.$client.prepare('SELECT id, from_name, company_name, subject, suppressed_at FROM inquiries WHERE id = ?').get(checked.payload.inquiryId) as { id: string; from_name: string; company_name: string | null; subject: string; suppressed_at: number | null } | undefined
  if (!inquiry || inquiry.suppressed_at) return NextResponse.json({ ok: false }, { status: 400 })
  const row = insertCall(db, {
    vapiCallId,
    callerName: inquiry.from_name,
    companyName: inquiry.company_name,
    inquiryId: inquiry.id,
    status: 'in-progress',
    summary: inquiry.subject,
  })
  return NextResponse.json({ ok: true, id: row.id, inquiryId: inquiry.id })
}
