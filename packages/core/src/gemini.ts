import { trustedTranscript, type Provider } from './providers'
import type { PolicyContext } from './policy'
import { parseToolArgs, TOOL_DEFS, WORKERS_AI_TOOLS, type ToolName } from './tool-schemas'
import {
  briefModelError,
  MalformedModelOutput,
  modelAttemptNotes,
  workersAiProvider,
  type AiBinding,
  type ModelFailure,
} from './workers-ai'
import { GROQ_DEFAULT_MODEL, groqModelTag, groqProvider, parseGroqModels } from './groq'

export const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite'
/** Comma-separated fallbacks tried on 404 / 429 / 503. */
export const GEMINI_DEFAULT_MODEL_LIST = 'gemini-3.5-flash-lite,gemini-3.1-flash-lite'
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

/** Keywords Gemini function-parameter Schema does not accept. */
export const GEMINI_FORBIDDEN_SCHEMA_KEYS = [
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'definitions',
  'additionalProperties',
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
] as const

/** Test seam. Production uses global fetch. */
export const geminiHttp: { fetch: typeof fetch } = {
  fetch: (input, init) => fetch(input, init),
}

export type GeminiOptions = {
  apiKey: string
  /** One model id, or a comma-separated list tried on 404/429/503. */
  model?: string
  fetch?: typeof fetch
  timeoutMs?: number
}

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args?: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } }

type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] }

export function parseGeminiModels(value?: string): string[] {
  const parts = String(value || GEMINI_DEFAULT_MODEL_LIST)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts : [GEMINI_DEFAULT_MODEL]
}

/**
 * Build Gemini functionDeclarations from the same tool schemas Workers AI uses.
 * Parameters are scrubbed to the OpenAPI subset Gemini accepts.
 */
export function geminiFunctionDeclarations(requiredTool?: string): Record<string, unknown>[] {
  const tools = requiredTool
    ? WORKERS_AI_TOOLS.filter((tool) => tool.name === requiredTool)
    : WORKERS_AI_TOOLS
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: scrubSchema(tool.parameters as Record<string, unknown>),
  }))
}

/**
 * Pure recursive scrubber: returns a cleaned schema at every level
 * (properties, items, anyOf/oneOf/allOf, additionalProperties objects).
 */
export function scrubSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { type: 'object', properties: {} }
  const source = schema as Record<string, unknown>

  // Collapse string|null (and similar) unions before copying fields.
  const collapsed = collapseNullUnion(source)
  const out: Record<string, unknown> = {}

  if (collapsed.const !== undefined && collapsed.enum === undefined) {
    out.enum = [collapsed.const]
  }

  for (const [key, value] of Object.entries(collapsed)) {
    if ((GEMINI_FORBIDDEN_SCHEMA_KEYS as readonly string[]).includes(key)) continue
    if (key === 'type') {
      applyType(out, value)
      continue
    }
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      const props: Record<string, unknown> = {}
      for (const [name, prop] of Object.entries(value as Record<string, unknown>)) {
        props[name] = scrubSchema(prop)
      }
      out.properties = props
      continue
    }
    if (key === 'items') {
      out.items = Array.isArray(value) ? scrubSchema(value[0] ?? {}) : scrubSchema(value)
      continue
    }
    if (key === 'anyOf' || key === 'oneOf' || key === 'allOf') {
      if (!Array.isArray(value)) continue
      const cleaned = value
        .filter((entry) => !(entry && typeof entry === 'object' && (entry as { type?: unknown }).type === 'null'))
        .map((entry) => scrubSchema(entry))
      // Gemini function parameters do not accept anyOf/oneOf/allOf; keep the first branch.
      if (cleaned[0]) Object.assign(out, cleaned[0])
      continue
    }
    if (key === 'required' && Array.isArray(value)) {
      out.required = value.filter((item) => typeof item === 'string')
      continue
    }
    if (key === 'enum' && Array.isArray(value)) {
      out.enum = value
      continue
    }
    if (value !== undefined) out[key] = value
  }

  // exclusiveMinimum / exclusiveMaximum were stripped; fold into minimum/maximum.
  foldExclusiveBounds(out, source)

  if (out.type === undefined && (out.properties || out.enum || out.items)) {
    out.type = out.items ? 'array' : out.properties ? 'object' : 'string'
  }

  return out
}

function collapseNullUnion(schema: Record<string, unknown>): Record<string, unknown> {
  for (const key of ['anyOf', 'oneOf'] as const) {
    const options = schema[key]
    if (!Array.isArray(options) || options.length < 2) continue
    const nullish = options.filter((entry) => entry && typeof entry === 'object' && (entry as { type?: unknown }).type === 'null')
    const rest = options.filter((entry) => !(entry && typeof entry === 'object' && (entry as { type?: unknown }).type === 'null'))
    if (nullish.length > 0 && rest.length === 1 && rest[0] && typeof rest[0] === 'object') {
      return { ...(rest[0] as Record<string, unknown>), nullable: true }
    }
  }
  return schema
}

function applyType(out: Record<string, unknown>, value: unknown): void {
  if (Array.isArray(value)) {
    const types = value.filter((item): item is string => typeof item === 'string')
    const nullable = types.includes('null')
    const primary = types.find((item) => item !== 'null') || 'string'
    out.type = primary
    if (nullable) out.nullable = true
    return
  }
  if (typeof value === 'string') {
    if (value === 'null') {
      out.type = 'string'
      out.nullable = true
      return
    }
    out.type = value
  }
}

function foldExclusiveBounds(out: Record<string, unknown>, source: Record<string, unknown>): void {
  const exclusiveMin = source.exclusiveMinimum
  const exclusiveMax = source.exclusiveMaximum
  const integer = out.type === 'integer'
  if (typeof exclusiveMin === 'number' && out.minimum === undefined) {
    out.minimum = integer ? Math.floor(exclusiveMin) + 1 : exclusiveMin
  }
  if (typeof exclusiveMax === 'number' && out.maximum === undefined) {
    out.maximum = integer ? Math.ceil(exclusiveMax) - 1 : exclusiveMax
  }
}

/** Walk a scrubbed schema and collect forbidden leftovers for tests. */
export function findForbiddenSchemaKeys(schema: unknown, path = ''): string[] {
  if (!schema || typeof schema !== 'object') return []
  if (Array.isArray(schema)) {
    return schema.flatMap((item, index) => findForbiddenSchemaKeys(item, `${path}[${index}]`))
  }
  const record = schema as Record<string, unknown>
  const hits: string[] = []
  for (const [key, value] of Object.entries(record)) {
    const here = path ? `${path}.${key}` : key
    if ((GEMINI_FORBIDDEN_SCHEMA_KEYS as readonly string[]).includes(key)) hits.push(here)
    if (key === 'type' && Array.isArray(value)) hits.push(`${here} (array)`)
    hits.push(...findForbiddenSchemaKeys(value, here))
  }
  return hits
}

export function buildGeminiContents(ctx: PolicyContext, nudge?: string): {
  systemInstruction: { parts: { text: string }[] }
  contents: GeminiContent[]
} {
  const transcript = trustedTranscript(ctx)
  const contents: GeminiContent[] = [
    { role: 'user', parts: [{ text: asText(transcript.user) }] },
  ]
  for (const step of ctx.steps) {
    if (!step.tool || step.status === 'error' || !TOOL_DEFS.some((tool) => tool.name === step.tool)) continue
    contents.push({
      role: 'model',
      parts: [{ functionCall: { name: step.tool, args: asRecord(step.args) } }],
    })
    contents.push({
      role: 'user',
      parts: [{
        functionResponse: {
          name: step.tool,
          response: asRecord(step.result),
        },
      }],
    })
  }
  const note = nudge || ctx.nudge
  if (note) contents.push({ role: 'user', parts: [{ text: asText(note) }] })
  return {
    systemInstruction: { parts: [{ text: asText(transcript.system) }] },
    contents,
  }
}

export function interpretGemini(payload: unknown):
  | { kind: 'tool'; name: string; args: unknown }
  | { kind: 'text'; text: string }
  | { kind: 'malformed'; detail: string } {
  if (!payload || typeof payload !== 'object') return { kind: 'malformed', detail: 'empty Gemini payload' }
  const candidate = (payload as { candidates?: { content?: { parts?: Record<string, unknown>[] } }[] }).candidates?.[0]
  const parts = candidate?.content?.parts
  if (!Array.isArray(parts) || parts.length === 0) return { kind: 'malformed', detail: 'Gemini returned no parts' }
  for (const part of parts) {
    const call = part.functionCall as { name?: string; args?: unknown } | undefined
    if (call?.name) return { kind: 'tool', name: call.name, args: call.args ?? {} }
  }
  const text = parts.map((part) => (typeof part.text === 'string' ? part.text : '')).join('\n').trim()
  if (text) return { kind: 'text', text }
  return { kind: 'malformed', detail: 'Gemini returned neither a function call nor text' }
}

/** True when Workers AI failures justify switching to Gemini / Groq. */
export function shouldFallbackToGemini(failures: ModelFailure[]): boolean {
  return failures.some((failure) => {
    if (failure.code === '4006') return true
    if (failure.code && /^5\d\d$/.test(failure.code)) return true
    return /timeout|timed out|AbortError|ETIMEDOUT|network|quota|neuron/i.test(failure.error)
  })
}

function redactSecrets(text: string, apiKey: string): string {
  return text.split(apiKey).join('[redacted]')
}

function shouldTryNextGeminiModel(status: number): boolean {
  return status === 404 || status === 429 || status === 503
}

export function geminiProvider(options: GeminiOptions): Provider {
  const models = parseGeminiModels(options.model)
  const fetchImpl = options.fetch ?? ((input, init) => geminiHttp.fetch(input, init))
  const timeoutMs = options.timeoutMs ?? 25_000
  const apiKey = options.apiKey
  return {
    name: 'gemini',
    async next(ctx) {
      const failures: ModelFailure[] = []
      let validationError = ''

      for (const model of models) {
        let tryNextModel = false
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const required = ctx.requiredTool
          const nudge = [
            required ? `Call only the tool ${required}. Do not answer in prose.` : '',
            ctx.nudge,
            validationError
              ? `The previous tool call was rejected: ${validationError}. Call ${required ?? 'the tool'} again with valid JSON. lines must be an array of objects with sku and qty, not a JSON string.`
              : '',
          ].filter(Boolean).join('\n\n')
          const built = buildGeminiContents(ctx, nudge || undefined)
          const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`
          let payload: unknown
          try {
            const response = await fetchImpl(url, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-goog-api-key': apiKey,
              },
              body: JSON.stringify({
                systemInstruction: built.systemInstruction,
                contents: built.contents,
                tools: [{ functionDeclarations: geminiFunctionDeclarations(required) }],
                toolConfig: required
                  ? { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [required] } }
                  : { functionCallingConfig: { mode: 'AUTO' } },
              }),
              signal: AbortSignal.timeout(timeoutMs),
            })
            const text = await response.text()
            const safe = redactSecrets(text, apiKey)
            if (!response.ok) {
              if (response.status === 429) {
                failures.push({
                  model,
                  code: '429',
                  error: '429: Gemini rate limit; AI daily limit reached, resets 08:00 MYT',
                })
              } else {
                const brief = briefModelError(`${response.status}: ${safe.slice(0, 160)}`)
                failures.push({ model, ...brief, error: redactSecrets(brief.error, apiKey) })
              }
              if (shouldTryNextGeminiModel(response.status)) {
                tryNextModel = true
                break
              }
              const summary = failures.map((failure) => `${failure.model}: ${failure.error}`).join('; ')
              throw new MalformedModelOutput(summary || 'Gemini tool call was malformed.', failures)
            }
            payload = JSON.parse(safe) as unknown
          } catch (error) {
            if (error instanceof MalformedModelOutput) throw error
            const message = redactSecrets(error instanceof Error ? error.message : 'Gemini transport error', apiKey)
            failures.push({ model, ...briefModelError(message) })
            tryNextModel = true
            break
          }
          const interpreted = interpretGemini(payload)
          if (interpreted.kind === 'tool') {
            if (!TOOL_DEFS.some((tool) => tool.name === interpreted.name)) {
              failures.push({ model, code: null, error: `unknown tool ${interpreted.name}` })
              tryNextModel = true
              break
            }
            const parsed = parseToolArgs(interpreted.name, asRecord(interpreted.args))
            if (!parsed.ok) {
              validationError = parsed.error
              failures.push({ model, ...briefModelError(parsed.error) })
              if (attempt === 0) continue
              tryNextModel = true
              break
            }
            return {
              type: 'tool' as const,
              name: interpreted.name as ToolName,
              args: parsed.data,
              model,
              attempts: modelAttemptNotes(failures),
            }
          }
          if (interpreted.kind === 'text') {
            if (ctx.requiredTool) {
              failures.push({ model, code: null, error: 'no tool call' })
              tryNextModel = true
              break
            }
            return { type: 'text' as const, text: interpreted.text, model, attempts: modelAttemptNotes(failures) }
          }
          failures.push({ model, ...briefModelError(interpreted.detail) })
          tryNextModel = true
          break
        }
        if (!tryNextModel) break
        validationError = ''
      }

      const summary = failures.map((failure) => `${failure.model}: ${failure.error}`).join('; ')
      throw new MalformedModelOutput(summary || 'Gemini tool call was malformed.', failures)
    },
  }
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return { value }
}

function withPriorAttempts(
  turn: Awaited<ReturnType<Provider['next']>>,
  prior: ReturnType<typeof modelAttemptNotes>,
): Awaited<ReturnType<Provider['next']>> {
  if (turn.type === 'tool' || turn.type === 'text') {
    return { ...turn, attempts: [...prior, ...(turn.attempts ?? [])] }
  }
  return turn
}

/**
 * Workers AI first (gpt-oss-120b, then Llama 3.3). On 4006 / quota / 5xx / timeout,
 * try Gemini, then Groq. Skip a provider when its API key is missing.
 */
export function deskModelProvider(options: {
  ai: AiBinding
  primary?: string
  fallback?: string
  geminiApiKey?: string
  geminiModel?: string
  groqApiKey?: string
  groqModel?: string
  fetch?: typeof fetch
}): Provider {
  const workers = workersAiProvider(options.ai, { primary: options.primary, fallback: options.fallback })
  const name = [
    'workers-ai',
    options.geminiApiKey ? 'gemini' : null,
    options.groqApiKey ? 'groq' : null,
  ].filter(Boolean).join('+')
  return {
    name,
    async next(ctx) {
      try {
        return await workers.next(ctx)
      } catch (error) {
        if (!(error instanceof MalformedModelOutput)) throw error
        if (!shouldFallbackToGemini(error.attempts)) throw error
        if (!options.geminiApiKey && !options.groqApiKey) throw error

        let failures = [...error.attempts]
        const prior = () => modelAttemptNotes(failures)

        if (options.geminiApiKey) {
          try {
            const turn = await geminiProvider({
              apiKey: options.geminiApiKey,
              model: options.geminiModel,
              fetch: options.fetch,
            }).next(ctx)
            return withPriorAttempts(turn, prior())
          } catch (geminiError) {
            const geminiFailures = geminiError instanceof MalformedModelOutput
              ? geminiError.attempts
              : [{
                  model: parseGeminiModels(options.geminiModel)[0] || GEMINI_DEFAULT_MODEL,
                  code: null,
                  error: geminiError instanceof Error ? geminiError.message : 'Gemini failed',
                }]
            failures = [...failures, ...geminiFailures]
          }
        }

        if (options.groqApiKey) {
          try {
            const turn = await groqProvider({
              apiKey: options.groqApiKey,
              model: options.groqModel,
              fetch: options.fetch,
            }).next(ctx)
            return withPriorAttempts(turn, prior())
          } catch (groqError) {
            const groqFailures = groqError instanceof MalformedModelOutput
              ? groqError.attempts
              : [{
                  model: groqModelTag(parseGroqModels(options.groqModel)[0] || GROQ_DEFAULT_MODEL),
                  code: null,
                  error: groqError instanceof Error ? groqError.message : 'Groq failed',
                }]
            failures = [...failures, ...groqFailures]
          }
        }

        const summary = failures.map((failure) => `${failure.model}: ${failure.error}`).join('; ')
        throw new MalformedModelOutput(summary || 'Model providers failed.', failures)
      }
    },
  }
}
