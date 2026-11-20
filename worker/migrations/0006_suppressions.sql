CREATE TABLE IF NOT EXISTS suppressions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  cleared_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_suppressions_value ON suppressions(kind, value);
