'use client'

import { useRef, useState } from 'react'

type VapiClient = {
  on(event: string, handler: (payload?: { id?: string }) => void): void
  start(assistantId: string, overrides?: { variableValues?: Record<string, string>; maxDurationSeconds?: number }): Promise<{ id?: string } | void>
  stop(): void
}

export function SalesLine({ mode, variableValues, token }: { mode: 'token' | 'public-key'; variableValues?: Record<string, string>; token?: string }) {
  const intro = mode === 'token'
    ? 'This line uses a short-lived token from the desk. A formal quote is not sent on the call.'
    : 'This line uses the public key for this site. A formal quote is not sent on the call, and the CRM is not written until an operator approves it.'
  const [message, setMessage] = useState(intro)
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState(false)
  const clientRef = useRef<VapiClient | null>(null)

  async function linkCall(vapiCallId: string | undefined) {
    if (!token || !vapiCallId) return
    await fetch('/api/voice/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, vapiCallId }),
    })
  }

  async function start() {
    if (live || clientRef.current || busy) return
    setBusy(true)
    const response = await fetch('/api/voice/session', { method: 'POST' })
    const payload = (await response.json()) as { error?: string; token?: string; publicKey?: string; assistantId?: string; mode?: string }
    if (!response.ok) {
      setMessage(payload.error || 'The line is unavailable.')
      setBusy(false)
      return
    }
    if (!payload.assistantId || (!payload.token && !payload.publicKey)) {
      setMessage('The sales line is not configured on this desk yet. Set the Vapi assistant id and a public key or private key.')
      setBusy(false)
      return
    }
    const sdk = await import('@vapi-ai/web')
    const Vapi = sdk.default
    const usingToken = payload.mode === 'token' || (payload.mode !== 'public-key' && Boolean(payload.token))
    setMessage(usingToken ? 'Starting the call with a short-lived token.' : 'Starting the call with the public key for this site.')
    const client = new Vapi(payload.token || payload.publicKey || '') as VapiClient
    clientRef.current = client
    client.on('call-start', (call) => {
      setLive(true)
      void linkCall(call?.id)
    })
    client.on('call-end', () => {
      clientRef.current = null
      setLive(false)
      setBusy(false)
      setMessage('Call ended. If you left contact details, they are waiting for an operator.')
    })
    const started = await client.start(payload.assistantId, variableValues ? { variableValues, maxDurationSeconds: 210 } : undefined)
    await linkCall(started?.id)
    setLive(true)
    setBusy(false)
    setMessage(usingToken
      ? 'Connected with a short-lived token. Ask about services, the Cedarhaven area, or a ballpark price.'
      : 'Connected with the public key for this site. Ask about services, the Cedarhaven area, or a ballpark price.')
  }

  function end() {
    clientRef.current?.stop()
    clientRef.current = null
    setLive(false)
    setBusy(false)
    setMessage('Call ended. If you left contact details, they are waiting for an operator.')
  }

  return (
    <div className="stack">
      <p>{message}</p>
      {live ? (
        <button className="btn danger" type="button" onClick={end}>End call</button>
      ) : (
        <button className="btn primary" type="button" onClick={() => void start()} disabled={busy}>
          {busy ? 'Connecting' : 'Call our sales line'}
        </button>
      )}
    </div>
  )
}
