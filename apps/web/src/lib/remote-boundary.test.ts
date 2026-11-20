import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decideDesk } from './ops'
import { sourceDashboard, sourceInquiry } from './source'

const PAGES = [
  'apps/web/src/app/(desk)/page.tsx',
  'apps/web/src/app/(desk)/inbox/[id]/page.tsx',
  'apps/web/src/app/(desk)/runs/[id]/page.tsx',
  'apps/web/src/app/(desk)/approvals/page.tsx',
  'apps/web/src/app/(desk)/approvals/[id]/page.tsx',
  'apps/web/src/app/(desk)/crm/page.tsx',
  'apps/web/src/app/(desk)/settings/page.tsx',
  'apps/web/src/app/(desk)/kb/page.tsx',
  'apps/web/src/app/(desk)/quotes/[id]/page.tsx',
  'apps/web/src/app/(desk)/calls/[id]/page.tsx',
]

describe('production console boundary', () => {
  afterEach(() => {
    delete process.env.WORKER_URL
    delete process.env.WORKER_AUTH_TOKEN
    vi.unstubAllGlobals()
  })

  it('keeps the console pages off local SQLite', () => {
    for (const file of PAGES) {
      expect(readFileSync(file, 'utf8'), file).not.toContain('deskDb(')
    }
    const runs = readFileSync('apps/web/src/app/api/runs/[id]/route.ts', 'utf8')
    const voice = readFileSync('apps/web/src/app/api/voice/session/route.ts', 'utf8')
    expect(runs).toContain('if (process.env.WORKER_URL)')
    expect(voice).toContain('if (process.env.WORKER_URL)')
  })

  it('reads the overview and an inquiry from the worker', async () => {
    process.env.WORKER_URL = 'https://worker.example'
    process.env.WORKER_AUTH_TOKEN = 'tok'
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/dashboard')) {
        return new Response(JSON.stringify({ openInquiries: 1, pendingApprovals: 0, quotes: 0, pipelineCents: 0, stages: [], recentInquiries: [], queue: [] }))
      }
      return new Response(JSON.stringify({ inquiry: { id: 'inq_1', subject: 'Windows' }, runs: [] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(sourceDashboard()).resolves.toMatchObject({ openInquiries: 1 })
    await expect(sourceInquiry('inq_1')).resolves.toMatchObject({ inquiry: { subject: 'Windows' } })
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://worker.example/api/dashboard')
  })

  it('approves through the worker and does not open SQLite', async () => {
    process.env.WORKER_URL = 'https://worker.example'
    process.env.WORKER_AUTH_TOKEN = 'tok'
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ runId: 'run_1' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(decideDesk({ id: 'apr_1', decision: 'approved', finalJson: '{}' })).resolves.toMatchObject({ runId: 'run_1' })
    expect(fetchMock).toHaveBeenCalledWith('https://worker.example/api/approvals/apr_1/decide', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ authorization: 'Bearer tok' }),
    }))
  })
})
