import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="auth">
      <div className="auth-card">
        <h1>Not found</h1>
        <p className="lede">That page is not in the desk.</p>
        <Link className="btn" href="/">Back to overview</Link>
      </div>
    </main>
  )
}
