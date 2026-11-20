import { CALL_WINDOW_MS, CALLS_PER_DAY, CALLS_PER_IP, utcDay } from '../../packages/core/src/limits'
import type { D1Like } from './d1'
import { takeDaily, takeWindow } from './limits'

type State = { storage: { sql: { exec(query: string, ...params: unknown[]): { toArray(): unknown[] } } } }

/** SQLite-backed Durable Object. One global object serializes the public call counters. */
export class RateLimiter {
  constructor(private ctx: State) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.endsWith('/reset')) {
      this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS rate_buckets (bucket_key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL)')
      this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS daily_counters (scope TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (scope, day))')
      this.ctx.storage.sql.exec('DELETE FROM rate_buckets')
      this.ctx.storage.sql.exec('DELETE FROM daily_counters')
      return Response.json({ ok: true, cleared: true })
    }
    const body = (await request.json()) as { hash: string; day?: string }
    const day = body.day || utcDay()
    this.ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS rate_buckets (bucket_key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL)',
    )
    this.ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS daily_counters (scope TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (scope, day))',
    )
    const db = sqlAsD1(this.ctx.storage.sql)
    const ipOk = await takeWindow(db, `call:${body.hash}`, CALLS_PER_IP, CALL_WINDOW_MS)
    if (!ipOk) return Response.json({ ok: false, reason: 'ip' }, { status: 429 })
    const dayOk = await takeDaily(db, 'calls', day, CALLS_PER_DAY)
    if (!dayOk) return Response.json({ ok: false, reason: 'day' }, { status: 429 })
    return Response.json({ ok: true })
  }
}

function sqlAsD1(sql: State['storage']['sql']): D1Like {
  return {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async all<T>() {
              return { results: sql.exec(query, ...values).toArray() as T[] }
            },
            async first<T>() {
              return (sql.exec(query, ...values).toArray()[0] as T) ?? null
            },
            async run() {
              sql.exec(query, ...values)
              return { meta: { changes: 1 } }
            },
          }
        },
      }
    },
    async exec(query: string) {
      sql.exec(query)
    },
  }
}
