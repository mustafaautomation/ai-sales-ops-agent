import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@meridian/core', async () => {
  const actual = await vi.importActual<typeof import('@meridian/core')>('@meridian/core')
  return {
    ...actual,
    openDatabase: () => {
      throw new Error('sqlite opened')
    },
    databasePath: () => {
      throw new Error('sqlite opened')
    },
    migrate: () => {
      throw new Error('sqlite opened')
    },
    hitRateLimit: () => {
      throw new Error('sqlite opened')
    },
  }
})

describe('voice session route', () => {
  afterEach(() => {
    delete process.env.WORKER_URL
    delete process.env.WORKER_AUTH_TOKEN
    vi.unstubAllGlobals()
  })

  it('asks the worker limiter instead of a local database', async () => {
    process.env.WORKER_URL = 'https://worker.example'
    process.env.WORKER_AUTH_TOKEN = 'tok'
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ mode: 'public-key', assistantId: 'asst', publicKey: 'pub' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { POST } = await import('./route')
    const response = await POST(new Request('https://sales.quvantic.com/api/voice/session', { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.8' } }))
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith('https://worker.example/api/voice/session', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ authorization: 'Bearer tok', 'x-visitor-ip': '203.0.113.8' }),
    }))
    await expect(response.json()).resolves.toMatchObject({ mode: 'public-key' })
  })
})