import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { fetchWithRetry } from '../packages/core/src/retry.ts'
import { createCrmApp } from './crm-api/src/app'
import { createEmailApp } from './email-api/src/app'

type Schema = Record<string, unknown>

function deref(schema: Schema, root: Schema): Schema {
  if (typeof schema.$ref === 'string') {
    const name = schema.$ref.split('/').pop() ?? ''
    const components = root.components as { schemas: Record<string, Schema> }
    return deref(structuredClone(components.schemas[name]), root)
  }
  const next: Schema = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'nullable') continue
    if (Array.isArray(value)) next[key] = value.map((item) => (item && typeof item === 'object' ? deref(item as Schema, root) : item))
    else if (value && typeof value === 'object') next[key] = deref(value as Schema, root)
    else next[key] = value
  }
  if (schema.nullable === true && typeof next.type === 'string') next.type = [next.type, 'null']
  return next
}

function validator(specPath: string, schemaName: string) {
  const root = parse(readFileSync(specPath, 'utf8')) as Schema
  const ajv = new Ajv({ allErrors: true, strict: false })
  addFormats(ajv)
  const validate = ajv.compile(deref({ $ref: `#/components/schemas/${schemaName}` }, root))
  return (data: unknown) => {
    const ok = validate(data)
    if (!ok) throw new Error(ajv.errorsText(validate.errors))
  }
}

const emailSpec = resolve('services/email-api/openapi.yaml')
const crmSpec = resolve('services/crm-api/openapi.yaml')

describe('email API contract', () => {
  it('matches the OpenAPI schemas and honors idempotency and faults', async () => {
    const app = createEmailApp()
    const health = validator(emailSpec, 'Health')
    const list = validator(emailSpec, 'MessageList')
    const message = validator(emailSpec, 'Message')
    const error = validator(emailSpec, 'Error')

    const healthResponse = await app.request('/health')
    expect(healthResponse.status).toBe(200)
    health(await healthResponse.json())

    const listResponse = await app.request('/v1/messages?direction=inbound')
    expect(listResponse.status).toBe(200)
    const listed = (await listResponse.json()) as { messages: { id: string }[] }
    list(listed)
    expect(listed.messages.length).toBeGreaterThanOrEqual(12)

    const one = await app.request('/v1/messages/e_north')
    expect(one.status).toBe(200)
    message(await one.json())

    const missing = await app.request('/v1/messages/missing')
    expect(missing.status).toBe(404)
    error(await missing.json())

    const body = {
      direction: 'outbound',
      from: 'desk@meridian-facilities.example',
      to: 'priya.shah@north-wharf.example',
      subject: 'Quote',
      body: 'Hello',
      clientKey: 'email:1',
    }
    const first = await app.request('/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'email:1' },
      body: JSON.stringify(body),
    })
    expect(first.status).toBe(201)
    const created = await first.json()
    message(created)
    const second = await app.request('/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'email:1' },
      body: JSON.stringify(body),
    })
    expect(second.status).toBe(201)
    expect(await second.json()).toEqual(created)
    const after = (await (await app.request('/v1/messages?direction=outbound')).json()) as { messages: unknown[] }
    expect(after.messages).toHaveLength(1)

    const invalid = await app.request('/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ direction: 'outbound' }),
    })
    expect(invalid.status).toBe(400)
    error(await invalid.json())

    const limited = await app.request('/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-fault': '429' },
      body: JSON.stringify(body),
    })
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('1')
    error(await limited.json())

    const fetchImpl: typeof fetch = async (url, init) => {
      const path = new URL(url).pathname
      return app.request(path, init)
    }
    const recovered = await fetchWithRetry('http://email.test/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'email:retry', 'x-fault': '500-once' },
      body: JSON.stringify({ ...body, clientKey: 'email:retry' }),
    }, { fetch: fetchImpl, attempts: 3, baseDelayMs: 1, sleep: async () => {}, timeoutMs: 500 })
    expect(recovered.status).toBe(201)
    message(await recovered.json())
  })
})

describe('CRM API contract', () => {
  it('matches the OpenAPI schemas, upserts by external key, and retries 500-once', async () => {
    const app = createCrmApp()
    const health = validator(crmSpec, 'Health')
    const list = validator(crmSpec, 'RecordList')
    const record = validator(crmSpec, 'Record')
    const error = validator(crmSpec, 'Error')

    health(await (await app.request('/health')).json())
    const all = (await (await app.request('/v1/records')).json()) as { records: { companyName: string }[] }
    list(all)
    expect(all.records.map((item) => item.companyName)).toContain('Harbor Glass Cooperative')

    const filtered = (await (await app.request('/v1/records?q=elm')).json()) as { records: unknown[] }
    list(filtered)
    expect(filtered.records).toHaveLength(1)

    const payload = {
      externalKey: 'north-wharf-logistics:nightly-office-cleaning',
      companyName: 'North Wharf Logistics',
      contactName: 'Priya Shah',
      contactEmail: 'priya.shah@north-wharf.example',
      dealTitle: 'Nightly office cleaning',
      stage: 'proposal',
      amountCents: 145401,
      quoteNumber: 'MF-1001',
    }
    const first = await app.request('/v1/upsert', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'crm:1' },
      body: JSON.stringify(payload),
    })
    expect(first.status).toBe(200)
    const saved = await first.json()
    record(saved)
    const again = await app.request('/v1/upsert', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'crm:1' },
      body: JSON.stringify(payload),
    })
    expect(await again.json()).toEqual(saved)

    const updated = await app.request('/v1/upsert', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'crm:2' },
      body: JSON.stringify({ ...payload, amountCents: 150000 }),
    })
    expect(updated.status).toBe(200)
    const updatedBody = (await updated.json()) as { amountCents: number }
    expect(updatedBody.amountCents).toBe(150000)
    const found = (await (await app.request('/v1/records?q=north-wharf')).json()) as { records: { amountCents: number }[] }
    expect(found.records).toHaveLength(1)
    expect(found.records[0]?.amountCents).toBe(150000)

    const invalid = await app.request('/v1/upsert', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companyName: 'Nope' }),
    })
    expect(invalid.status).toBe(400)
    error(await invalid.json())

    const fetchImpl: typeof fetch = async (url, init) => app.request(new URL(url).pathname, init)
    const recovered = await fetchWithRetry(
      'http://crm.test/v1/upsert',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'crm:retry', 'x-fault': '500-once' },
        body: JSON.stringify({ ...payload, externalKey: 'other:deal', quoteNumber: null }),
      },
      { fetch: fetchImpl, attempts: 3, baseDelayMs: 1, sleep: async () => {}, timeoutMs: 500 },
    )
    expect(recovered.status).toBe(200)
    record(await recovered.json())
  })
})
