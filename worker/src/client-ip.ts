export function bearerMatches(request: Request, token: string | undefined): boolean {
  const header = request.headers.get('authorization') ?? ''
  const presented = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  return Boolean(token) && presented === token
}

/** Forwarded visitor IPs are trusted only from the authenticated Vercel server. */
export function visitorAddress(request: Request, token: string | undefined): string {
  const direct = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
  if (!bearerMatches(request, token)) return direct
  return request.headers.get('x-visitor-ip')?.trim() || direct
}
