import { cookies } from 'next/headers'
import { sessionSecret, verifySession, type SessionRole } from './token'

export { READ_ONLY_HINT } from './copy'

export async function currentSession(): Promise<{ sid: string; role: SessionRole } | null> {
  const jar = await cookies()
  const token = jar.get('meridian_session')?.value
  if (!token) return null
  return verifySession(token, sessionSecret())
}

export async function isOperatorSession(): Promise<boolean> {
  const session = await currentSession()
  return session?.role === 'operator'
}

export async function isDemoSession(): Promise<boolean> {
  const session = await currentSession()
  return session?.role === 'demo'
}
