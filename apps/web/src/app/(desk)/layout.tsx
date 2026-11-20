import { getSession, listApprovals, OPERATOR } from '@meridian/core'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Nav } from '../../components/nav'
import { ThemeToggle } from '../../components/theme-toggle'
import { ensureBoot } from '../../lib/boot'
import { deskDb } from '../../lib/desk'
import { currentSession, READ_ONLY_HINT } from '../../lib/session'
import { sourceApprovals, workerConfigured } from '../../lib/source'
import { sessionSecret, verifySession } from '../../lib/token'
import { logout } from '../(public)/actions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function DeskLayout({ children }: { children: ReactNode }) {
  const jar = await cookies()
  const token = jar.get('meridian_session')?.value
  const verified = token ? await verifySession(token, sessionSecret()) : null
  if (!verified) redirect('/login')
  const sessionMeta = await currentSession()
  const readOnly = sessionMeta?.role === 'demo'
  const remote = workerConfigured()
  if (!remote) await ensureBoot()
  const session = remote ? { user: { name: OPERATOR.name, email: OPERATOR.email } } : getSession(deskDb(), verified.sid)
  if (!session) redirect('/login')
  const approvals = remote ? await sourceApprovals() : listApprovals(deskDb())
  const pending = approvals.filter((approval) => approval.status === 'pending').length
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-inner">
          <div className="brand">
            <div className="mark" aria-hidden="true">
              M
            </div>
            <div>
              <strong>Meridian</strong>
              <span>Facilities desk</span>
            </div>
          </div>
          <Nav pending={pending} />
          <div className="side-foot">
            <div>{session.user.name}</div>
            <div className="muted">Synthetic demo workspace</div>
            <form action={logout}>
              <button type="submit">Sign out</button>
            </form>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-meta">
            <div className="crumb">Meridian Facilities · synthetic demo</div>
            {readOnly ? (
              <span className="role-chip demo" title={READ_ONLY_HINT}>
                Read-only demo · <Link href="/login">Sign in as operator</Link>
              </span>
            ) : (
              <span className="role-chip operator">Operator</span>
            )}
          </div>
          <div className="top-actions">
            <ThemeToggle />
            <span className="who">{session.user.name}</span>
            <form action={logout}>
              <button className="btn small" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </header>
        <div className="content" id="content">
          {children}
        </div>
      </div>
    </div>
  )
}