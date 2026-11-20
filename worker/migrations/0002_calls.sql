CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  vapi_call_id TEXT UNIQUE,
  visitor_hash TEXT,
  from_number TEXT,
  caller_name TEXT,
  company_name TEXT,
  inquiry_id TEXT,
  status TEXT NOT NULL,
  summary TEXT,
  transcript TEXT,
  outcome TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS daily_counters (
  scope TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (scope, day)
);
CREATE INDEX IF NOT EXISTS idx_calls_created ON calls(created_at DESC);
