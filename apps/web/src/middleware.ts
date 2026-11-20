import { NextResponse, type NextRequest } from 'next/server'
import { sessionSecret, verifySession } from './lib/token'

const PUBLIC = [/^\/login$/, /^\/inquire$/, /^\/icon\.svg$/]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
}
