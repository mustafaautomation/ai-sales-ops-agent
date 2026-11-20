import type { DB } from './db'

export const MIGRATION_0001 = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS inquiries (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  external_id TEXT UNIQUE,
  from_name TEXT NOT NULL,
  from_email TEXT NOT NULL,
  company_name TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  intent TEXT,
  injection_flag INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  inquiry_id TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT NOT NULL,
  disposition TEXT,
  summary TEXT,
  error TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS agent_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  tool_name TEXT,
  status TEXT NOT NULL,
  args_json TEXT,
  result_json TEXT,
  redacted_args_json TEXT,
  redacted_result_json TEXT,
  approval_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL,
  proposed_json TEXT NOT NULL,
  final_json TEXT,
  note TEXT,
  decided_by TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  inquiry_id TEXT,
  run_id TEXT,
  company_name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT NOT NULL,
  discount_code TEXT,
  discount_bps INTEGER NOT NULL,
  tax_bps INTEGER NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  notes TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS quote_lines (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  sku TEXT NOT NULL,
  description TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  line_total_cents INTEGER NOT NULL,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS crm_companies (
  id TEXT PRIMARY KEY,
  external_id TEXT UNIQUE,
  name TEXT NOT NULL,
  domain TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS crm_contacts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES crm_companies(id),
  name TEXT,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS crm_deals (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES crm_companies(id),
  external_id TEXT UNIQUE,
  title TEXT NOT NULL,
  stage TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  quote_id TEXT,
  inquiry_id TEXT,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kb_documents (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kb_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES kb_documents(id),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  heading TEXT NOT NULL,
  content TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  detail TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_buckets (
  bucket_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outbound_messages (
  id TEXT PRIMARY KEY,
  approval_id TEXT UNIQUE,
  inquiry_id TEXT,
  quote_id TEXT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  provider_message_id TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inquiries_created ON inquiries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_inquiry ON agent_runs(inquiry_id);
CREATE INDEX IF NOT EXISTS idx_steps_run ON agent_steps(run_id, step_index);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status, created_at);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON crm_deals(stage);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);
`

export const MIGRATION_0002 = `
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
`

export const MIGRATION_0003 = `
ALTER TABLE agent_steps ADD COLUMN model TEXT;
`

export const MIGRATION_0004 = `
ALTER TABLE agent_steps ADD COLUMN started_at INTEGER;
ALTER TABLE agent_steps ADD COLUMN finished_at INTEGER;
`

export const MIGRATION_0005 = `
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
`

export const MIGRATION_0006 = `
CREATE TABLE IF NOT EXISTS suppressions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  cleared_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_suppressions_value ON suppressions(kind, value);
`

export const MIGRATIONS = [
  { id: '0001_init', sql: MIGRATION_0001 },
  { id: '0002_calls', sql: MIGRATION_0002 },
  { id: '0003_step_model', sql: MIGRATION_0003 },
  { id: '0004_step_times', sql: MIGRATION_0004 },
  { id: '0005_outbound', sql: MIGRATION_0005 },
  { id: '0006_suppressions', sql: MIGRATION_0006 },
]

export function migrate(db: DB): void {
  const raw = db.$client
  raw.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
  )
  const applied = raw.prepare('SELECT id FROM schema_migrations WHERE id = ?')
  const mark = raw.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)')
  for (const migration of MIGRATIONS) {
    if (applied.get(migration.id)) continue
    const run = raw.transaction(() => {
      raw.exec(migration.sql)
      mark.run(migration.id, Date.now())
    })
    run()
  }
}
