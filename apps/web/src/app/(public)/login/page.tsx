import { OPERATOR } from '@meridian/core'
import Link from 'next/link'
import { demoEnabled } from '../../../lib/desk'
import { login } from '../actions'
import { Notice } from '../../../components/ui'

export const metadata = { title: 'Sign in' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const query = await searchParams
  return (
    <main className="auth">
      <div className="auth-card">
      <form action={login}>
        <p className="kicker">Meridian Facilities</p>
        <h1>Desk sign in</h1>
        <p className="lede">One operator account for this demo. Synthetic mail only.</p>
        {query.error ? <Notice tone="warn">That email or password did not match.</Notice> : null}
        <input type="hidden" name="next" value={query.next || '/'} />
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" defaultValue={OPERATOR.email} required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <div className="row-actions">
          <button className="btn primary" type="submit">Sign in</button>
        </div>
      </form>
      {demoEnabled() ? (
        <form action={login}>
          <input type="hidden" name="demo" value="1" />
          <input type="hidden" name="next" value={query.next || '/'} />
          <button className="btn" type="submit">Enter demo workspace</button>
        </form>
      ) : null}
      <p className="muted">
        Public inquiries go through the <Link href="/inquire">web form</Link>.
      </p>
      </div>
    </main>
  )
}
