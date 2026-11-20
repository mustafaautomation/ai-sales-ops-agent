'use server'

import { createSession, deleteSession, findUserByEmail, OPERATOR, submitWebInquiry, verifyPassword } from '@meridian/core'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { ensureBoot } from '../../lib/boot'
import { deskDb, deskPorts, demoEnabled } from '../../lib/desk'
import { sessionSecret, signSession, type SessionRole } from '../../lib/token'

async function setSessionCookie(sid: string, role: SessionRole, expiresAt: number) {
  const token = await signSession(sid, sessionSecret(), expiresAt, role)
  const jar = await cookies()
  jar.set('meridian_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.max(60, Math.floor((expiresAt - Date.now()) / 1000)),
  })
}

export async function login(formData: FormData) {
  const nextRaw = String(formData.get('next') || '/overview')
  const next = nextRaw.startsWith('/') ? nextRaw : '/overview'
  const demo = formData.get('demo') === '1' && demoEnabled()

  if (process.env.WORKER_URL) {
    if (demo) {
      await setSessionCookie('demo', 'demo', Date.now() + 7 * 24 * 60 * 60 * 1000)
      redirect(next === '/' ? '/overview' : next)
    }
    const email = String(formData.get('email') || '')
    const password = String(formData.get('password') || '')
    if (email !== OPERATOR.email || password !== OPERATOR.password) redirect('/login?error=1')
    await setSessionCookie('operator', 'operator', Date.now() + 7 * 24 * 60 * 60 * 1000)
    redirect(next === '/' ? '/overview' : next)
  }

  await ensureBoot()
  if (demo) {
    const user = findUserByEmail(deskDb(), OPERATOR.email)
    if (!user) redirect('/login?error=1')
    const session = createSession(deskDb(), user.id)
    await setSessionCookie(session.id, 'demo', session.expiresAt)
    redirect(next === '/' ? '/overview' : next)
  }
  const email = String(formData.get('email') || '')
  const password = String(formData.get('password') || '')
  const user = findUserByEmail(deskDb(), email)
  if (!user || !verifyPassword(password, user.passwordHash)) redirect('/login?error=1')
  const session = createSession(deskDb(), user.id)
  await setSessionCookie(session.id, 'operator', session.expiresAt)
  redirect(next === '/' ? '/overview' : next)
}

export async function enterDemoDesk() {
  const form = new FormData()
  form.set('demo', '1')
  form.set('next', '/overview')
  await login(form)
}

export async function logout() {
  const jar = await cookies()
  if (!process.env.WORKER_URL) {
    await ensureBoot()
    const token = jar.get('meridian_session')?.value
    if (token) {
      const { verifySession } = await import('../../lib/token')
      const verified = await verifySession(token, sessionSecret())
      if (verified) deleteSession(deskDb(), verified.sid)
    }
  }
  jar.delete('meridian_session')
  redirect('/')
}

export async function submitInquiry(formData: FormData) {
  if (process.env.WORKER_URL) {
    const headerList = await headers()
    const ip = headerList.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
    const response = await fetch(`${process.env.WORKER_URL}/api/public/inquiries`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.WORKER_AUTH_TOKEN ?? ''}`,
        'content-type': 'application/json',
        'x-visitor-ip': ip,
      },
      body: JSON.stringify({
        name: formData.get('name'),
        email: formData.get('email'),
        company: formData.get('company'),
        subject: formData.get('subject'),
        message: formData.get('message'),
        phone: formData.get('phone') || null,
        consentEmail: formData.get('consentEmail') === 'on',
        consentCall: formData.get('consentCall') === 'on',
      }),
    })
    const payload = (await response.json().catch(() => ({}))) as { id?: string; error?: string }
    if (response.status === 403) {
      redirect(`/inquire?error=${encodeURIComponent(payload.error || 'This address has asked us to stop.')}`)
    }
    if (response.status === 429) {
      redirect(`/inquire?error=${encodeURIComponent(payload.error || 'Too many inquiries from this network today.')}`)
    }
    if (!response.ok) redirect('/inquire?error=The+desk+could+not+store+that+inquiry.')
    redirect(`/inquire?received=${payload.id}`)
  }
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
