import { OPERATOR } from '@meridian/core'
import Link from 'next/link'
import { demoEnabled } from '../../../lib/desk'
import { login } from '../actions'
import { ArrowLeft } from 'lucide-react'
import { LogoMark } from '../../../components/logo'
import { Notice } from '../../../components/ui'

export const metadata = { title: 'Sign in' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const query = await searchParams
  const next = query.next && query.next.startsWith('/') ? query.next : '/overview'
  return (
    <main className="auth">
      <div className="auth-card">
        <Link className="back-link" href="/"><ArrowLeft aria-hidden="true" />Back to landing</Link>
        <div className="auth-brand"><LogoMark />Meridian Desk</div>
        <form action={login}>
          <h1>Desk sign in</h1>
          <p className="lede" style={{ marginBottom: 18 }}>One operator account for this demo. Synthetic mail only.</p>
          {query.error ? <Notice tone="warn">That email or password did not match.</Notice> : null}
          <input type="hidden" name="next" value={next} />
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="username" defaultValue={OPERATOR.email} required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <button className="btn primary lg" type="submit" style={{ width: '100%' }}>
            Sign in
          </button>
        </form>
        {demoEnabled() ? (
          <form action={login}>
            <div className="or">or browse without signing in</div>
            <input type="hidden" name="demo" value="1" />
            <input type="hidden" name="next" value={next} />
            <button className="btn lg" type="submit" style={{ width: '100%' }}>
              Enter demo workspace
            </button>
          </form>
        ) : null}
        <p className="muted" style={{ marginTop: 18, marginBottom: 0, fontSize: 13 }}>
          The demo workspace is read-only. Public inquiries go through the{' '}
          <Link href="/inquire" style={{ textDecoration: 'underline' }}>web form</Link>.
        </p>
      </div>
    </main>
  )
}