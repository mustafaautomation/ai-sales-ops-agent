export type D1Like = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
      first<T = Record<string, unknown>>(): Promise<T | null>
      run(): Promise<{ meta?: { changes?: number } }>
    }
  }
  exec(sql: string): Promise<unknown>
}

export async function applySql(db: D1Like, sql: string): Promise<void> {
  const statements = sql
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !statement.startsWith('--'))
  for (const statement of statements) {
    await db.prepare(statement).bind().run()
  }
}

export async function migrateD1(db: D1Like, files: { id: string; sql: string }[]): Promise<void> {
  await db.prepare('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)').bind().run()
  for (const file of files) {
    const existing = await db.prepare('SELECT id FROM schema_migrations WHERE id = ?').bind(file.id).first()
    if (existing) continue
    await applySql(db, file.sql)
    await db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').bind(file.id, Date.now()).run()
  }
}
