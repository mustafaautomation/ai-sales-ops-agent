import type { D1Like } from './d1'

export async function takeWindow(db: D1Like, key: string, limit: number, windowMs: number, at = Date.now()): Promise<boolean> {
  const row = await db.prepare('SELECT window_start, count FROM rate_buckets WHERE bucket_key = ?').bind(key).first<{ window_start: number; count: number }>()
  if (!row || at - row.window_start >= windowMs) {
    if (!row) await db.prepare('INSERT INTO rate_buckets (bucket_key, window_start, count) VALUES (?, ?, 1)').bind(key, at).run()
    else await db.prepare('UPDATE rate_buckets SET window_start = ?, count = 1 WHERE bucket_key = ?').bind(at, key).run()
    return true
  }
  if (row.count >= limit) return false
  await db.prepare('UPDATE rate_buckets SET count = count + 1 WHERE bucket_key = ?').bind(key).run()
  return true
}

export async function takeDaily(db: D1Like, scope: string, day: string, limit: number): Promise<boolean> {
  const row = await db.prepare('SELECT count FROM daily_counters WHERE scope = ? AND day = ?').bind(scope, day).first<{ count: number }>()
  if (!row) {
    await db.prepare('INSERT INTO daily_counters (scope, day, count) VALUES (?, ?, 1)').bind(scope, day).run()
    return true
  }
  if (row.count >= limit) return false
  await db.prepare('UPDATE daily_counters SET count = count + 1 WHERE scope = ? AND day = ?').bind(scope, day).run()
  return true
}
