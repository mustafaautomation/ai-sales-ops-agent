import { NextResponse, type NextRequest } from 'next/server'
import { sessionSecret, verifySession } from './lib/token'

const PUBLIC = [/^\/$/, /^\/login$/, /^\/inquire$/, /^\/confirm$/, /^\/unsubscribed$/, /^\/call(\/|$)/, /^\/api\/voice\//, /^\/api\/vapi\//, /^\/icon\.svg$/, /^\/media\//]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  // RFC 8058 one-click: POST the same public unsubscribe URL used in List-Unsubscribe.
  if (pathname === '/unsubscribed' && request.method === 'POST') {
    const token = request.nextUrl.searchParams.get('token') ?? ''
    if (process.env.WORKER_URL) {
      const upstream = await fetch(
        `${process.env.WORKER_URL.replace(/\/$/, '')}/api/public/unsubscribe?token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'content-type': request.headers.get('content-type') || 'application/x-www-form-urlencoded' },
          body: await request.text(),
        },
      )
      return new NextResponse(await upstream.text(), {
        status: upstream.status,
        headers: { 'content-type': upstream.headers.get('content-type') || 'application/json' },
      })
    }
    return NextResponse.json({ ok: Boolean(token) }, { status: token ? 200 : 400 })
  }
  if (PUBLIC.some((pattern) => pattern.test(pathname))) return NextResponse.next()
  const token = request.cookies.get('meridian_session')?.value
  const session = token ? await verifySession(token, sessionSecret()) : null
  if (!session) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|media/).*)'],
}
