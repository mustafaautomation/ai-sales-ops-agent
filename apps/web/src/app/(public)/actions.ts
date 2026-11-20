'use server'

import { createSession, deleteSession, findUserByEmail, OPERATOR, submitWebInquiry, verifyPassword } from '@meridian/core'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { ensureBoot } from '../../lib/boot'
import { deskDb, deskPorts, demoEnabled } from '../../lib/desk'
import { sessionSecret, signSession } from '../../lib/token'
export async function login(formData: FormData) {
  await ensureBoot()
  const demo = formData.get('demo') === '1' && demoEnabled()
  const email = demo ? OPERATOR.email : String(formData.get('email') || '')
  const password = demo ? OPERATOR.password : String(formData.get('password') || '')
  const user = findUserByEmail(deskDb(), email)
  if (!user || !verifyPassword(password, user.passwordHash)) redirect('/login?error=1')
  const session = createSession(deskDb(), user.id)
  const token = await signSession(session.id, sessionSecret(), session.expiresAt)
  const jar = await cookies()
  jar.set('meridian_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    expires: new Date(session.expiresAt),
  })
  const next = String(formData.get('next') || '/')
  redirect(next.startsWith('/') ? next : '/')
}

export async function logout() {
  await ensureBoot()
  const jar = await cookies()
  const token = jar.get('meridian_session')?.value
  if (token) {
    const { verifySession } = await import('../../lib/token')
    const verified = await verifySession(token, sessionSecret())
    if (verified) deleteSession(deskDb(), verified.sid)
  }
  jar.delete('meridian_session')
  redirect('/login')
}

export async function submitInquiry(formData: FormData) {
  await ensureBoot()
  const headerList = await headers()
  const ip = headerList.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const result = await submitWebInquiry(
    deskDb(),
    deskPorts(),
    {
      name: formData.get('name'),
      email: formData.get('email'),
      company: formData.get('company'),
      subject: formData.get('subject'),
      message: formData.get('message'),
    },
    ip,
  )
  if (!result.ok) redirect(`/inquire?error=${encodeURIComponent(result.message)}`)
  redirect(`/inquire?received=${result.id}`)
}
