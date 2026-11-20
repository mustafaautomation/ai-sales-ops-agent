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
    getRun: () => {
      throw new Error('sqlite opened')
    },
    listSteps: () => {
      throw new Error('sqlite opened')
    },
  }
})

describe('run timeline route', () => {
  afterEach(() => {
    delete process.env.WORKER_URL
    delete process.env.WORKER_AUTH_TOKEN
    vi.unstubAllGlobals()
  })

  it('reads the run from the worker and continues it while it is running', async () => {
    process.env.WORKER_URL = 'https://worker.example'
    process.env.WORKER_AUTH_TOKEN = 'tok'
    const payload = {
      run: { status: 'running', inquiryId: 'inq_1' },
      steps: [{ id: 'stp_1', toolName: 'search_kb', status: 'ok', redactedResultJson: '{}' }],
    }
    const done = { ...payload, run: { status: 'awaiting_approval', inquiryId: 'inq_1' } }
    let reads = 0
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response('{}')
      reads += 1
      return new Response(JSON.stringify(reads > 1 ? done : payload))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('./route')
    const response = await GET(new Request('https://sales.quvantic.com/api/runs/run_1'), { params: Promise.resolve({ id: 'run_1' }) })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'awaiting_approval' })
    expect(fetchMock).toHaveBeenCalledWith('https://worker.example/api/inquiries/inq_1/step', expect.objectContaining({ method: 'POST' }))
  })
})