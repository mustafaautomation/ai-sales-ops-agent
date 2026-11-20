import type { D1Like } from './d1'
import { driveInquiry, type WorkerEnv } from './desk'

export const STALE_RUN_MS = 2 * 60 * 1000

async function one<T>(db: D1Like, sql: string, ...args: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...args).first<T>()
}

/** One model step, then ask the caller to start the next request if the run is still going. */
export async function chainAdvance(
  db: D1Like,
  env: WorkerEnv,
  inquiryId: string,
  kick: (inquiryId: string) => Promise<void>,
  attempts = 3,
): Promise<Record<string, unknown>> {
  let last: Record<string, unknown> = { status: 'running', inquiryId }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      last = await driveInquiry(db, env, inquiryId, 1)
      if (last.busy) return last
      if (last.status === 'running') await kick(String(last.inquiryId ?? inquiryId))
      return last
    } catch (error) {
      last = { status: 'running', inquiryId, error: error instanceof Error ? error.message : 'step failed' }
    }
  }
  return last
}

/** Runs left `running` with no step newer than two minutes. A live drive lock is left alone. */
export async function listStaleRuns(db: D1Like, now = Date.now()): Promise<string[]> {
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
  const stale: string[] = []
  for (const row of rows.results) {
    if (Number(row.touched) > cutoff) continue
    const lock = await one<{ created_at: number }>(db, 'SELECT created_at FROM idempotency_keys WHERE key = ?', `drive:${row.inquiry_id}`)
    if (lock && now - lock.created_at < 60_000) continue
    if (lock) await db.prepare('DELETE FROM idempotency_keys WHERE key = ?').bind(`drive:${row.inquiry_id}`).run()
    stale.push(row.inquiry_id)
  }
  return stale
}
