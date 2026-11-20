import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const inquiries = sqliteTable('inquiries', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  externalId: text('external_id').unique(),
  fromName: text('from_name').notNull(),
  fromEmail: text('from_email').notNull(),
  companyName: text('company_name'),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  status: text('status').notNull(),
  intent: text('intent'),
  injectionFlag: integer('injection_flag').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const agentRuns = sqliteTable('agent_runs', {
  id: text('id').primaryKey(),
  inquiryId: text('inquiry_id').notNull(),
  status: text('status').notNull(),
  provider: text('provider').notNull(),
  disposition: text('disposition'),
  summary: text('summary'),
  error: text('error'),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
})

export const agentSteps = sqliteTable('agent_steps', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  stepIndex: integer('step_index').notNull(),
  kind: text('kind').notNull(),
  toolName: text('tool_name'),
  status: text('status').notNull(),
  argsJson: text('args_json'),
  resultJson: text('result_json'),
  redactedArgsJson: text('redacted_args_json'),
  redactedResultJson: text('redacted_result_json'),
  approvalId: text('approval_id'),
  model: text('model'),
  createdAt: integer('created_at').notNull(),
  startedAt: integer('started_at'),
  finishedAt: integer('finished_at'),
})

export const approvals = sqliteTable('approvals', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  toolName: text('tool_name').notNull(),
  status: text('status').notNull(),
  proposedJson: text('proposed_json').notNull(),
  finalJson: text('final_json'),
  note: text('note'),
  decidedBy: text('decided_by'),
  createdAt: integer('created_at').notNull(),
  decidedAt: integer('decided_at'),
})

export const quotes = sqliteTable('quotes', {
  id: text('id').primaryKey(),
  number: text('number').notNull().unique(),
  inquiryId: text('inquiry_id'),
  runId: text('run_id'),
  companyName: text('company_name').notNull(),
  contactName: text('contact_name'),
  contactEmail: text('contact_email').notNull(),
  discountCode: text('discount_code'),
  discountBps: integer('discount_bps').notNull(),
  taxBps: integer('tax_bps').notNull(),
  subtotalCents: integer('subtotal_cents').notNull(),
  discountCents: integer('discount_cents').notNull(),
  taxCents: integer('tax_cents').notNull(),
  totalCents: integer('total_cents').notNull(),
  currency: text('currency').notNull(),
  status: text('status').notNull(),
  validUntil: text('valid_until').notNull(),
  notes: text('notes'),
  createdAt: integer('created_at').notNull(),
})

export const quoteLines = sqliteTable('quote_lines', {
  id: text('id').primaryKey(),
  quoteId: text('quote_id').notNull(),
  sku: text('sku').notNull(),
  description: text('description').notNull(),
  qty: integer('qty').notNull(),
  unitPriceCents: integer('unit_price_cents').notNull(),
  lineTotalCents: integer('line_total_cents').notNull(),
  position: integer('position').notNull(),
})

export const crmCompanies = sqliteTable('crm_companies', {
  id: text('id').primaryKey(),
  externalId: text('external_id').unique(),
  name: text('name').notNull(),
  domain: text('domain'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const crmContacts = sqliteTable('crm_contacts', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  name: text('name'),
  email: text('email').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const crmDeals = sqliteTable('crm_deals', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  externalId: text('external_id').unique(),
  title: text('title').notNull(),
  stage: text('stage').notNull(),
  amountCents: integer('amount_cents').notNull(),
  quoteId: text('quote_id'),
  inquiryId: text('inquiry_id'),
  source: text('source').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const kbDocuments = sqliteTable('kb_documents', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const kbChunks = sqliteTable('kb_chunks', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  ordinal: integer('ordinal').notNull(),
  heading: text('heading').notNull(),
  content: text('content').notNull(),
})

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  at: integer('at').notNull(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  detail: text('detail').notNull(),
})

export const idempotencyKeys = sqliteTable('idempotency_keys', {
  key: text('key').primaryKey(),
  scope: text('scope').notNull(),
  responseJson: text('response_json').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const rateBuckets = sqliteTable('rate_buckets', {
  bucketKey: text('bucket_key').primaryKey(),
  windowStart: integer('window_start').notNull(),
  count: integer('count').notNull(),
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const calls = sqliteTable('calls', {
  id: text('id').primaryKey(),
  vapiCallId: text('vapi_call_id').unique(),
  visitorHash: text('visitor_hash'),
  fromNumber: text('from_number'),
  callerName: text('caller_name'),
  companyName: text('company_name'),
  inquiryId: text('inquiry_id'),
  status: text('status').notNull(),
  summary: text('summary'),
  transcript: text('transcript'),
  outcome: text('outcome'),
  startedAt: integer('started_at'),
  endedAt: integer('ended_at'),
  createdAt: integer('created_at').notNull(),
})

export const dailyCounters = sqliteTable('daily_counters', {
  scope: text('scope').notNull(),
  day: text('day').notNull(),
  count: integer('count').notNull(),
})

export const outboundMessages = sqliteTable('outbound_messages', {
  id: text('id').primaryKey(),
  approvalId: text('approval_id').unique(),
  inquiryId: text('inquiry_id'),
  quoteId: text('quote_id'),
  toEmail: text('to_email').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  providerMessageId: text('provider_message_id'),
  status: text('status').notNull(),
  createdAt: integer('created_at').notNull(),
})
