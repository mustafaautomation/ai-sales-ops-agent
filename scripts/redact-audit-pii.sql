-- Idempotent PII redaction for audit_log.
-- Run manually against production D1 (wrangler d1 execute) or local SQLite.
-- Safe to re-run: rows already masked (containing ***) are skipped.
-- Do not apply from CI or automatic deploys.

-- 1) Mask entity_id values that are still raw emails.
UPDATE audit_log
SET entity_id =
  substr(entity_id, 1, 1) || '***@' || substr(entity_id, instr(entity_id, '@') + 1)
WHERE entity_id LIKE '%@%'
  AND entity_id NOT LIKE '%***%'
  AND instr(entity_id, '@') > 1;

-- 2) Mask entity_id values that look like raw phone numbers (digits / +digits).
UPDATE audit_log
SET entity_id =
  '+' || '***' || substr(replace(replace(replace(entity_id, '+', ''), '-', ''), ' ', ''), -4)
WHERE entity_id NOT LIKE '%@%'
  AND entity_id NOT LIKE 'pii_%'
  AND entity_id NOT LIKE '%***%'
  AND length(replace(replace(replace(entity_id, '+', ''), '-', ''), ' ', '')) >= 8
  AND replace(replace(replace(entity_id, '+', ''), '-', ''), ' ', '') GLOB '[0-9]*';

-- 3) Mask $.email inside detail JSON when still raw.
UPDATE audit_log
SET detail = replace(
  detail,
  '"' || json_extract(detail, '$.email') || '"',
  '"' || substr(json_extract(detail, '$.email'), 1, 1) || '***@' ||
    substr(json_extract(detail, '$.email'), instr(json_extract(detail, '$.email'), '@') + 1) || '"'
)
WHERE json_valid(detail)
  AND json_extract(detail, '$.email') IS NOT NULL
  AND typeof(json_extract(detail, '$.email')) = 'text'
  AND json_extract(detail, '$.email') LIKE '%@%'
  AND json_extract(detail, '$.email') NOT LIKE '%***%'
  AND instr(json_extract(detail, '$.email'), '@') > 1;

-- 4) Mask $.phone inside detail JSON when still raw.
UPDATE audit_log
SET detail = replace(
  detail,
  '"' || json_extract(detail, '$.phone') || '"',
  '"' || '+' || '***' || substr(replace(json_extract(detail, '$.phone'), '+', ''), -4) || '"'
)
WHERE json_valid(detail)
  AND json_extract(detail, '$.phone') IS NOT NULL
  AND typeof(json_extract(detail, '$.phone')) = 'text'
  AND json_extract(detail, '$.phone') NOT LIKE '%***%'
  AND length(replace(json_extract(detail, '$.phone'), '+', '')) >= 4;
