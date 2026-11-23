import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { backdateDemo, DEMO_FIXTURE_IDS } from './boot'
import { closeDatabase, openDatabase } from './db'
import { migrate } from './migrate'
import { createInquiry } from './run'
import { getInquiry, listAudit, seedReference, writeAudit } from './store'

afterEach(() => closeDatabase())

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'meridian-boot-'))
  const db = openDatabase(join(dir, 'test.db'))
  migrate(db)
  seedReference(db)
  return db
}

function add(db: ReturnType<typeof tempDb>, source: string, externalId: string | null) {
  const row = createInquiry(db, {
    source,
    externalId,
    fromName: 'Test Sender',
    fromEmail: 'sender@test.example',
    companyName: 'Test Co',
    subject: `Subject ${externalId}`,
    body: 'Body',
  })
  writeAudit(db, { actor: 'agent', action: 'inquiry.classified', entityType: 'inquiry', entityId: row.id, detail: {} })
  return row
}

describe('backdateDemo', () => {
  it('shifts fixture inquiries and leaves real ones alone', () => {
    const db = tempDb()
    const fixtureA = add(db, 'email', 'e_north')
    const fixtureB = add(db, 'email', 'e_pike')
    const realWeb = add(db, 'web', 'web:inq_real')
    const realEmail = add(db, 'email', 'msg_20261120_real')
    const lookalike = add(db, 'web', 'e_north_copy')
    const noExternal = add(db, 'voice', null)

    const shifted = backdateDemo(db, { DEMO_MODE: 'true' })

    expect(shifted.sort()).toEqual([fixtureA.id, fixtureB.id].sort())
    for (const row of [fixtureA, fixtureB]) {
      const after = getInquiry(db, row.id)
      expect(after?.createdAt).toBeLessThan(row.createdAt)
      expect(after?.updatedAt).toBeLessThan(row.updatedAt)
    }
    for (const row of [realWeb, realEmail, lookalike, noExternal]) {
      const after = getInquiry(db, row.id)
      expect(after?.createdAt).toBe(row.createdAt)
      expect(after?.updatedAt).toBe(row.updatedAt)
    }
    const audit = listAudit(db, 50)
    const realIds = new Set([realWeb.id, realEmail.id, lookalike.id, noExternal.id])
    const oldestReal = Math.min(...audit.filter((event) => realIds.has(event.entityId)).map((event) => event.at))
    const newestFixture = Math.max(...audit.filter((event) => !realIds.has(event.entityId)).map((event) => event.at))
    expect(newestFixture).toBeLessThan(oldestReal)
  })

  it('does not treat a fixture id on a non-email source as seeded', () => {
    const db = tempDb()
    const row = add(db, 'web', 'e_silo')
    expect(backdateDemo(db, { DEMO_MODE: 'true' })).toEqual([])
    expect(getInquiry(db, row.id)?.createdAt).toBe(row.createdAt)
  })

  it('does nothing when demo mode is off', () => {
    const db = tempDb()
    const row = add(db, 'email', 'e_north')
    expect(backdateDemo(db, { DEMO_MODE: 'false' })).toEqual([])
    expect(getInquiry(db, row.id)?.createdAt).toBe(row.createdAt)
  })

  it('lists exactly the ids the mock email API serves', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../../../services/email-api/src/app.ts', import.meta.url), 'utf8')
    const served = [...source.matchAll(/id: '(e_[a-z]+)'/g)].map((match) => match[1]).sort()
    expect([...DEMO_FIXTURE_IDS].sort()).toEqual(served)
  })
})
