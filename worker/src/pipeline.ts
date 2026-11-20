import type { D1Like } from './d1'
import { driveInquiry, type WorkerEnv } from './desk'

export const STALE_RUN_MS = 2 * 60 * 1000
export const STALE_CONFIRMED_MS = 60 * 1000

export type DriveEnv = WorkerEnv & {
  SELF?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> }
  WORKER_AUTH_TOKEN?: string
}

async function one<T>(db: D1Like, sql: string, ...args: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...args).first<T>()
}

function driveUrl(request: Request, inquiryId: string): string {
  const url = new URL(request.url)
  url.pathname = '/api/internal/drive'
  url.search = `?inquiry=${encodeURIComponent(inquiryId)}`
  return url.toString()
}

/**
 * Start the next drive hop. Prefer the SELF service binding; same-zone public
 * fetch to workers.dev never arrives on Cloudflare. Without SELF, advance in-process.
 *
 * Safety with long model calls: `/api/internal/drive` awaits driveInquiry in the
 * request itself, then waitUntil(kick) only to fire the *next* hop. SELF.fetch
 * therefore waits until that hop's model work finishes and returns 202, so a
 * hop cannot be canceled mid-call by returning early from waitUntil.
 */
export async function kick(request: Request, env: DriveEnv, inquiryId: string): Promise<void> {
  const init: RequestInit = {
    method: 'POST',
    headers: { authorization: `Bearer ${env.WORKER_AUTH_TOKEN || ''}` },
  }
  try {
    if (env.SELF) {
      await env.SELF.fetch(driveUrl(request, inquiryId), init)
      return
    }
    await chainAdvance(env.DB, env, inquiryId, (id) => kick(request, env, id))
  } catch {
    // The next request's stale-run sweep retries a run left running.
  }
}

/**
 * One model step, then ask the caller to start the next request if the run is still going.
 * `next` is only invoked after driveInquiry returns, so model work always finishes first.
 */
export async function chainAdvance(
  db: D1Like,
  env: WorkerEnv,
  inquiryId: string,
  next: (inquiryId: string) => Promise<void>,
  attempts = 3,
): Promise<Record<string, unknown>> {
  let last: Record<string, unknown> = { status: 'running', inquiryId }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      last = await driveInquiry(db, env, inquiryId, 1)
      if (last.busy) return last
      if (last.status === 'running') await next(String(last.inquiryId ?? inquiryId))
      return last
    } catch (error) {
      last = { status: 'running', inquiryId, error: error instanceof Error ? error.message : 'step failed' }
    }
  }
  return last
}

/**
 * Confirmed inquiries with no run yet (older than one minute), and runs left
 * `running` with no step newer than two minutes. A live drive lock is left alone.
 */
export async function listStaleRuns(db: D1Like, now = Date.now()): Promise<string[]> {
  const stale = new Set<string>()
  const confirmedCutoff = now - STALE_CONFIRMED_MS
  const confirmed = await db.prepare(
    `SELECT id FROM inquiries
     WHERE email_verified_at IS NOT NULL
       AND email_verified_at <= ?
       AND status = 'processing'
       AND NOT EXISTS (SELECT 1 FROM agent_runs WHERE inquiry_id = inquiries.id)`,
  ).bind(confirmedCutoff).all<{ id: string }>()
  for (const row of confirmed.results) stale.add(row.id)

  const cutoff = now - STALE_RUN_MS
  const rows = await db.prepare(
    `SELECT r.inquiry_id AS inquiry_id,
            COALESCE(
              (SELECT MAX(COALESCE(finished_at, created_at)) FROM agent_steps WHERE run_id = r.id),
              r.started_at,
              0
            ) AS touched
     FROM agent_runs r
     WHERE r.status = 'running'`,
  ).bind().all<{ inquiry_id: string; touched: number }>()
  for (const row of rows.results) {
    if (Number(row.touched) > cutoff) continue
    const lock = await one<{ created_at: number }>(db, 'SELECT created_at FROM idempotency_keys WHERE key = ?', `drive:${row.inquiry_id}`)
    if (lock && now - lock.created_at < 60_000) continue
    if (lock) await db.prepare('DELETE FROM idempotency_keys WHERE key = ?').bind(`drive:${row.inquiry_id}`).run()
    stale.add(row.inquiry_id)
  }
  return [...stale]
}
