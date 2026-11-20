import { describe, expect, it } from 'vitest'
import { findGroqSchemaProblems, scrubSchemaForGroq } from './groq-schema'
import { groqFunctionTools } from './groq'
import { jsonSchemaFor, TOOL_DEFS, TOOL_NAMES, toolSchemas } from './tool-schemas'

describe('Groq strict tool schemas', () => {
  it('scrubs the real zod-to-json-schema output for every tool', () => {
    for (const name of TOOL_NAMES) {
      const raw = jsonSchemaFor(toolSchemas[name as keyof typeof toolSchemas])
      const cleaned = scrubSchemaForGroq(raw)
      expect(findGroqSchemaProblems(cleaned), name).toEqual([])
      expect(JSON.stringify(cleaned)).not.toContain('"exclusiveMinimum"')
      expect(JSON.stringify(cleaned)).not.toContain('"additionalProperties":true')
      expect(cleaned.additionalProperties).toBe(false)
      const props = cleaned.properties as Record<string, unknown>
      expect(Array.isArray(cleaned.required)).toBe(true)
      expect([...(cleaned.required as string[])].sort()).toEqual(Object.keys(props).sort())
    }
  })

  it('makes draft_quote and get_price_list Groq-safe', () => {
    const draft = scrubSchemaForGroq(jsonSchemaFor(toolSchemas.draft_quote))
    const lines = (draft.properties as Record<string, Record<string, unknown>>).lines
    const qty = (lines.items as { properties: { qty: Record<string, unknown> } }).properties.qty
    expect(qty.exclusiveMinimum).toBeUndefined()
    expect(qty.minimum).toBe(1)
    const discount = (draft.properties as Record<string, Record<string, unknown>>).discountCode
    expect(Array.isArray(discount.type)).toBe(true)
    expect(discount.type).toEqual(expect.arrayContaining(['string', 'null']))

    const priceList = scrubSchemaForGroq(jsonSchemaFor(toolSchemas.get_price_list))
    expect(priceList.additionalProperties).toBe(false)
    expect(priceList.required).toEqual(['category'])
    const category = (priceList.properties as Record<string, Record<string, unknown>>).category
    expect(category.type).toEqual(expect.arrayContaining(['string', 'null']))
  })

  it('emits scrubbed parameters on every Groq function tool', () => {
    const declared = groqFunctionTools() as { function: { name: string; parameters: Record<string, unknown> } }[]
    expect(declared.map((tool) => tool.function.name).sort()).toEqual(TOOL_DEFS.map((tool) => tool.name).slice().sort())
    for (const tool of declared) {
      expect(findGroqSchemaProblems(tool.function.parameters), tool.function.name).toEqual([])
    }
  })
})
