/**
 * Groq / OpenAI strict tool parameters:
 * - every property listed in required
 * - nullable via type ["x","null"] (not nullable: true)
 * - additionalProperties: false on every object
 * - no exclusiveMinimum / anyOf / unsupported keywords
 */

const FORBIDDEN = new Set([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'definitions',
  'additionalItems',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'default',
  'const',
  'examples',
  'example',
  'title',
  'patternProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  'dependentRequired',
  'dependentSchemas',
  'if',
  'then',
  'else',
  'not',
  'propertyNames',
  'contentMediaType',
  'contentEncoding',
  'deprecated',
  'readOnly',
  'writeOnly',
  'nullable',
])

function asTypeList(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  return []
}

function withNull(schema: Record<string, unknown>): Record<string, unknown> {
  const types = asTypeList(schema.type).filter((item) => item !== 'null')
  const primary = types[0] || (schema.properties ? 'object' : schema.items ? 'array' : 'string')
  return { ...schema, type: [primary, 'null'] }
}

function foldExclusive(out: Record<string, unknown>, source: Record<string, unknown>): void {
  if (typeof source.exclusiveMinimum === 'number') {
    const floor = source.exclusiveMinimum + (Number.isInteger(source.exclusiveMinimum) ? 1 : Number.EPSILON)
    out.minimum = typeof out.minimum === 'number' ? Math.max(out.minimum, floor) : floor
  }
  if (typeof source.exclusiveMaximum === 'number') {
    const ceil = source.exclusiveMaximum - (Number.isInteger(source.exclusiveMaximum) ? 1 : Number.EPSILON)
    out.maximum = typeof out.maximum === 'number' ? Math.min(out.maximum, ceil) : ceil
  }
}

function collapseNullUnion(schema: Record<string, unknown>): { base: Record<string, unknown>; nullable: boolean } {
  for (const key of ['anyOf', 'oneOf'] as const) {
    const options = schema[key]
    if (!Array.isArray(options) || options.length < 2) continue
    const nullish = options.filter((entry) => entry && typeof entry === 'object' && (entry as { type?: unknown }).type === 'null')
    const rest = options.filter((entry) => !(entry && typeof entry === 'object' && (entry as { type?: unknown }).type === 'null'))
    if (nullish.length > 0 && rest.length === 1 && rest[0] && typeof rest[0] === 'object') {
      return { base: rest[0] as Record<string, unknown>, nullable: true }
    }
  }
  return { base: schema, nullable: schema.nullable === true || asTypeList(schema.type).includes('null') }
}

/** Scrub zod-to-json-schema output for Groq function tools. */
export function scrubSchemaForGroq(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'object', properties: {}, required: [], additionalProperties: false }
  }
  const { base, nullable } = collapseNullUnion(schema as Record<string, unknown>)
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(base)) {
    if (FORBIDDEN.has(key)) continue
    if (key === 'type') {
      const types = asTypeList(value).filter((item) => item !== 'null')
      out.type = types.length === 1 ? types[0] : types.length > 1 ? types : 'object'
      continue
    }
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      const originalRequired = new Set(
        Array.isArray(base.required) ? base.required.filter((item): item is string => typeof item === 'string') : [],
      )
      const props: Record<string, unknown> = {}
      for (const [name, prop] of Object.entries(value as Record<string, unknown>)) {
        let cleaned = scrubSchemaForGroq(prop)
        // Strict mode lists every property as required; optional fields become nullable.
        if (!originalRequired.has(name)) cleaned = withNull(cleaned)
        props[name] = cleaned
      }
      out.properties = props
      out.required = Object.keys(props)
      out.additionalProperties = false
      continue
    }
    if (key === 'items') {
      out.items = Array.isArray(value) ? scrubSchemaForGroq(value[0] ?? {}) : scrubSchemaForGroq(value)
      continue
    }
    if (key === 'anyOf' || key === 'oneOf' || key === 'allOf') {
      if (!Array.isArray(value)) continue
      const cleaned = value
        .filter((entry) => !(entry && typeof entry === 'object' && (entry as { type?: unknown }).type === 'null'))
        .map((entry) => scrubSchemaForGroq(entry))
      if (cleaned[0]) Object.assign(out, cleaned[0])
      continue
    }
    if (key === 'required' && Array.isArray(value)) {
      // Recomputed from properties for strict mode.
      continue
    }
    if (key === 'enum' && Array.isArray(value)) {
      out.enum = value
      continue
    }
    if (key === 'additionalProperties') continue
    if (value !== undefined) out[key] = value
  }

  foldExclusive(out, base)

  if (out.type === undefined) {
    out.type = out.items ? 'array' : out.properties ? 'object' : 'string'
  }

  if (out.properties && typeof out.properties === 'object') {
    out.required = Object.keys(out.properties as Record<string, unknown>)
    out.additionalProperties = false
  }

  if (nullable) {
    const types = asTypeList(out.type).filter((item) => item !== 'null')
    const primary = types[0] || 'string'
    out.type = [primary, 'null']
  }

  return out
}

export function findGroqSchemaProblems(schema: unknown, path = ''): string[] {
  const problems: string[] = []
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return problems
  const node = schema as Record<string, unknown>
  for (const key of Object.keys(node)) {
    if (FORBIDDEN.has(key) || key === 'exclusiveMinimum' || key === 'exclusiveMaximum') {
      problems.push(`${path || '/'}: forbidden key ${key}`)
    }
  }
  if (node.properties && typeof node.properties === 'object') {
    const props = Object.keys(node.properties as Record<string, unknown>)
    const required = Array.isArray(node.required) ? node.required.map(String) : []
    for (const name of props) {
      if (!required.includes(name)) problems.push(`${path}.properties: ${name} not required`)
    }
    if (node.additionalProperties !== false) problems.push(`${path || '/'}: additionalProperties must be false`)
    for (const [name, prop] of Object.entries(node.properties as Record<string, unknown>)) {
      problems.push(...findGroqSchemaProblems(prop, `${path}.properties.${name}`))
    }
  }
  if (node.items) problems.push(...findGroqSchemaProblems(node.items, `${path}.items`))
  return problems
}
