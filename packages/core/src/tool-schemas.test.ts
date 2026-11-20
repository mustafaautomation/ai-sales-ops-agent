import { describe, expect, it } from 'vitest'
import { parseToolArgs, WORKERS_AI_TOOLS } from './tool-schemas'

describe('Workers AI tool JSON Schema', () => {
  it('describes numbers, enums, required fields, and array items', () => {
    const search = WORKERS_AI_TOOLS.find((tool) => tool.name === 'search_kb')
    const draft = WORKERS_AI_TOOLS.find((tool) => tool.name === 'draft_quote')
    const upsert = WORKERS_AI_TOOLS.find((tool) => tool.name === 'crm_upsert')
    const parameters = search?.parameters as {
      properties: { limit: { type: string } }
      required: string[]
    }
    expect(parameters.properties.limit.type).toBe('integer')
    expect(parameters.required).toEqual(['query'])
    const lines = (draft?.parameters as { properties: { lines: { items: { properties: { qty: { type: string } }; required: string[] } } }; required: string[] }).properties.lines
    expect(lines.items.properties.qty.type).toBe('integer')
    expect(lines.items.required).toEqual(['sku', 'qty'])
    expect((draft?.parameters as { required: string[] }).required).toContain('companyName')
    expect((draft?.parameters as { required: string[] }).required).not.toContain('discountCode')
    const stage = (upsert?.parameters as { properties: { stage: { enum: string[] } } }).properties.stage
    expect(stage.enum).toEqual(['lead', 'qualified', 'proposal', 'won', 'lost'])
    expect(WORKERS_AI_TOOLS).toMatchSnapshot()
  })

  it('coerces numeric strings and a quantity alias before validation', () => {
    const search = parseToolArgs('search_kb', { query: 'hours', limit: '5' })
    expect(search).toEqual({ ok: true, data: { query: 'hours', limit: 5 } })
    const draft = parseToolArgs('draft_quote', {
      companyName: 'North Wharf Logistics',
      contactName: 'Priya Shah',
      contactEmail: 'priya.shah@north-wharf.example',
      lines: [{ sku: 'WINDOW', quantity: '24' }],
    })
    expect(draft.ok).toBe(true)
    if (draft.ok) expect(draft.data.lines).toEqual([{ sku: 'WINDOW', qty: 24 }])
    const broken = parseToolArgs('search_kb', { query: 'hours', limit: 'five' })
    expect(broken.ok).toBe(false)
    const encoded = parseToolArgs('draft_quote', {
      companyName: 'North Wharf Logistics',
      contactName: 'Priya Shah',
      contactEmail: 'priya.shah@north-wharf.example',
      lines: JSON.stringify([{ sku: 'WINDOW', quantity: '24' }]),
    })
    expect(encoded.ok).toBe(true)
    if (encoded.ok) expect(encoded.data.lines).toEqual([{ sku: 'WINDOW', qty: 24 }])
  })
})
