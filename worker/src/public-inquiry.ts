import { classifyText } from '../../packages/core/src/classify'
import { FORM_PER_DAY, hashVisitor, LLM_PER_DAY, LLM_PER_IP_DAY, utcDay } from '../../packages/core/src/limits'
import type { D1Like } from './d1'
import { createInquiry, driveInquiry, type WorkerEnv } from './desk'
import { takeDaily, takeWindow } from './limits'

export async function acceptPublicInquiry(
  db: D1Like,
  env: WorkerEnv,
  body: { name?: string; email?: string; company?: string; subject?: string; message?: string },
  ip: string,
  ctx?: { waitUntil(promise: Promise<unknown>): void },
): Promise<Response> {
  const subject = String(body.subject ?? '')
  const message = String(body.message ?? '')
  const classification = classifyText(`${subject}\n${message}`)
  const hash = await hashVisitor(ip, env.RATE_LIMIT_SALT || 'meridian')
  const ipOk = await takeWindow(db, `form:${hash}`, 5, 10 * 60 * 1000)
  const dayOk = await takeDaily(db, 'form', utcDay(), FORM_PER_DAY)
  if (!ipOk || !dayOk) return Response.json({ error: 'Too many inquiries from this network today. Try again later.' }, { status: 429 })
  if (classification.intent !== 'spam') {
    const llmIp = await takeWindow(db, `llm:${hash}`, LLM_PER_IP_DAY, 24 * 60 * 60 * 1000)
    const llmDay = await takeDaily(db, 'llm', utcDay(), LLM_PER_DAY)
    if (!llmIp || !llmDay) return Response.json({ error: 'Too many inquiries from this network today. Try again later.' }, { status: 429 })
  }
  const id = await createInquiry(db, {
    source: 'web',
    fromName: String(body.name ?? ''),
    fromEmail: String(body.email ?? ''),
    companyName: body.company ? String(body.company) : null,
    subject,
    body: message,
  })
  const stepped = await driveInquiry(db, env, id, 8)
  if (stepped.status === 'running') ctx?.waitUntil(driveInquiry(db, env, id, 8))
  return Response.json({ id, ...stepped }, { status: 201 })
}
