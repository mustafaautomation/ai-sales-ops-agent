import { id } from '../../packages/core/src/ids'
import { auditDetailJson, auditEntityId } from '../../packages/core/src/mask'
import type { D1Like } from './d1'

/** Single write path for worker audit rows — always masks emails/phones. */
export async function writeAuditRow(
  db: D1Like,
  entry: {
    actor: string
    action: string
    entityType: string
    entityId: string
    detail: unknown
    at?: number
  },
): Promise<void> {
  const entityId = await auditEntityId(entry.entityId)
  await db
    .prepare(
      `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id('aud'), entry.at ?? Date.now(), entry.actor, entry.action, entry.entityType, entityId, auditDetailJson(entry.detail))
    .run()
}
