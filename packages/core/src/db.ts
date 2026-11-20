import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

export type DB = BetterSQLite3Database<typeof schema> & { $client: Database.Database }

type Cache = { path: string; db: DB }

const globalStore = globalThis as unknown as { __meridianDb?: Cache }

export function openDatabase(path: string): DB {
  const cached = globalStore.__meridianDb
  if (cached?.path === path) return cached.db
  if (cached) {
    cached.db.$client.close()
    globalStore.__meridianDb = undefined
  }
  mkdirSync(dirname(path), { recursive: true })
  const raw = new Database(path)
  raw.pragma('journal_mode = WAL')
  raw.pragma('foreign_keys = ON')
  const db = drizzle(raw, { schema }) as DB
  globalStore.__meridianDb = { path, db }
  return db
}

export function closeDatabase(): void {
  globalStore.__meridianDb?.db.$client.close()
  globalStore.__meridianDb = undefined
}
