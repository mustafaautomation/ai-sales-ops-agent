ALTER TABLE inquiries ADD COLUMN phone TEXT;
ALTER TABLE inquiries ADD COLUMN timezone TEXT;
ALTER TABLE inquiries ADD COLUMN email_opt_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inquiries ADD COLUMN call_opt_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inquiries ADD COLUMN email_verified_at INTEGER;
ALTER TABLE inquiries ADD COLUMN suppressed_at INTEGER;
ALTER TABLE outbound_messages ADD COLUMN provider TEXT;
ALTER TABLE outbound_messages ADD COLUMN error TEXT;
ALTER TABLE calls ADD COLUMN direction TEXT;
ALTER TABLE calls ADD COLUMN recording_url TEXT;
CREATE TABLE IF NOT EXISTS outbound_calls (
  id TEXT PRIMARY KEY,
  inquiry_id TEXT,
  approval_id TEXT,
  phone TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  vapi_call_id TEXT,
  scheduled_at INTEGER,
  started_at INTEGER,
  ended_at INTEGER,
  summary TEXT,
  created_at INTEGER NOT NULL
);
