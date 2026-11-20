import { getSession, listApprovals, OPERATOR } from '@meridian/core'
import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Nav } from '../../components/nav'
import { ThemeToggle } from '../../components/theme-toggle'
import { ensureBoot } from '../../lib/boot'
import { deskDb } from '../../lib/desk'
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
  const remote = workerConfigured()
  if (!remote) await ensureBoot()
  const session = remote ? { user: { name: OPERATOR.name, email: OPERATOR.email } } : getSession(deskDb(), verified.sid)
  if (!session) redirect('/login')
  const approvals = remote ? await sourceApprovals() : listApprovals(deskDb())
  const pending = approvals.filter((approval) => approval.status === 'pending').length
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark" aria-hidden="true">M</div>
          <div>
            <strong>Meridian</strong>
            <span>Facilities desk</span>
          </div>
        </div>
        <Nav pending={pending} />
        <div className="side-foot">
          <div>{session.user.name}</div>
          <div>Cedarhaven</div>
          <form action={logout}>
            <button type="submit">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="crumb">Meridian Facilities · synthetic demo</div>
          <div className="top-actions">
            <ThemeToggle />
            <span className="who">{session.user.email}</span>
          </div>
        </header>
        <div className="content" id="content">
          {children}
        </div>
      </div>
    </div>
  )
}
