import { databasePath, hitRateLimit, migrate, openDatabase } from '@meridian/core'
import { hashVisitor, utcDay, CALL_WINDOW_MS, CALLS_PER_DAY, CALLS_PER_IP } from '@meridian/core'
import { signVapiPublicJwt } from '@meridian/core'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local'
  if (process.env.WORKER_URL) {
    const response = await fetch(`${process.env.WORKER_URL}/api/voice/session`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.WORKER_AUTH_TOKEN ?? ''}`,
        'content-type': 'application/json',
        'x-visitor-ip': ip,
      },
      cache: 'no-store',
    })
    const body = await response.text()
    return new NextResponse(body, { status: response.status, headers: { 'content-type': 'application/json' } })
  }
  const db = openDatabase(databasePath())
  migrate(db)
  const hash = await hashVisitor(ip, process.env.RATE_LIMIT_SALT || 'local-salt')
  const ipOk = hitRateLimit(db, `call:${hash}`, CALLS_PER_IP, CALL_WINDOW_MS)
  const dayKey = `calls:${utcDay()}`
  const day = hitRateLimit(db, dayKey, CALLS_PER_DAY, 24 * 60 * 60 * 1000)
  if (!ipOk.ok || !day.ok) {
    return NextResponse.json({ error: 'The sales line is at its demo limit for now. You can still write to us from the form.' }, { status: 429 })
  }
  const assistantId = process.env.VAPI_ASSISTANT_ID || ''
  if (process.env.VAPI_PRIVATE_KEY && process.env.VAPI_ORG_ID) {
    const token = await signVapiPublicJwt({
      privateKey: process.env.VAPI_PRIVATE_KEY,
      orgId: process.env.VAPI_ORG_ID,
      assistantId,
      origin: process.env.PUBLIC_ORIGIN || 'https://sales.quvantic.com',
      ttlSeconds: 600,
    })
    return NextResponse.json({ mode: 'token', assistantId, token })
  }
  return NextResponse.json({ mode: 'public-key', assistantId, publicKey: process.env.VAPI_PUBLIC_KEY || '' })
}
