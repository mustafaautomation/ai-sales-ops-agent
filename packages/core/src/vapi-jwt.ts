function b64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** Public Vapi Web SDK token. HS256, signed with the private API key, exp within one hour. */
export async function signVapiPublicJwt(input: {
  privateKey: string
  orgId: string
  assistantId?: string
  origin?: string
  ttlSeconds?: number
}): Promise<string> {
  const ttl = Math.min(input.ttlSeconds ?? 600, 3600)
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payload = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        orgId: input.orgId,
        exp: now + ttl,
        token: {
          tag: 'public',
          restrictions: {
            enabled: true,
            allowedOrigins: input.origin ? [input.origin] : [],
            allowedAssistantIds: input.assistantId ? [input.assistantId] : [],
          },
        },
      }),
    ),
  )
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(input.privateKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${payload}`))
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`
}

export async function secretsMatch(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const a = encoder.encode(provided)
  const b = encoder.encode(expected)
  if (a.byteLength !== b.byteLength || a.byteLength === 0) return false
  const key = await crypto.subtle.importKey('raw', a, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const other = await crypto.subtle.importKey('raw', b, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const left = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode('meridian')))
  const right = new Uint8Array(await crypto.subtle.sign('HMAC', other, encoder.encode('meridian')))
  let diff = 0
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index]
  return diff === 0
}
