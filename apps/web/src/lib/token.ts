const encoder = new TextEncoder()

export type SessionRole = 'demo' | 'operator'

function bytesToB64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function b64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((value.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function sessionSecret(): string {
  return process.env.SESSION_SECRET || 'dev-only-session-secret'
}

export async function signSession(
  sessionId: string,
  secret: string,
  exp: number,
  role: SessionRole = 'operator',
): Promise<string> {
  const body = bytesToB64(encoder.encode(JSON.stringify({ sid: sessionId, exp, role })))
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  return `${body}.${bytesToB64(new Uint8Array(sig))}`
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<{ sid: string; role: SessionRole } | null> {
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const ok = await crypto.subtle.verify('HMAC', key, b64ToBytes(sig), encoder.encode(body))
  if (!ok) return null
  try {
    const data = JSON.parse(new TextDecoder().decode(b64ToBytes(body))) as { sid?: string; exp?: number; role?: string }
    if (!data.sid || typeof data.exp !== 'number' || data.exp < Date.now()) return null
    const role: SessionRole = data.role === 'demo' ? 'demo' : 'operator'
    return { sid: data.sid, role }
  } catch {
    return null
  }
}
