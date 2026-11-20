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

export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash'
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

/** Test seam. Production uses global fetch. */
export const geminiHttp: { fetch: typeof fetch } = {
  fetch: (input, init) => fetch(input, init),
}

export type GeminiOptions = {
  apiKey: string
  model?: string
  fetch?: typeof fetch
  timeoutMs?: number
}

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args?: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } }

type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] }

/**
 * Build Gemini functionDeclarations from the same tool schemas Workers AI uses.
 * Strip JSON Schema fields Gemini rejects (additionalProperties, $schema).
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

function scrubSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>
  delete copy.$schema
  delete copy.additionalProperties
  for (const value of Object.values(copy)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) scrubSchema(value as Record<string, unknown>)
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') scrubSchema(item as Record<string, unknown>)
      }
    }
  }
  return copy
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

/** True when Workers AI failures justify switching to Gemini. */
export function shouldFallbackToGemini(failures: ModelFailure[]): boolean {
  return failures.some((failure) => {
    if (failure.code === '4006') return true
    if (failure.code && /^5\d\d$/.test(failure.code)) return true
    return /timeout|timed out|AbortError|ETIMEDOUT|network/i.test(failure.error)
  })
}

function redactSecrets(text: string, apiKey: string): string {
  return text.split(apiKey).join('[redacted]')
}

export function geminiProvider(options: GeminiOptions): Provider {
  const model = options.model || GEMINI_DEFAULT_MODEL
  const fetchImpl = options.fetch ?? ((input, init) => geminiHttp.fetch(input, init))
  const timeoutMs = options.timeoutMs ?? 25_000
  const apiKey = options.apiKey
  return {
    name: 'gemini',
    async next(ctx) {
      const failures: ModelFailure[] = []
      let validationError = ''
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
            const brief = briefModelError(`${response.status}: ${safe.slice(0, 160)}`)
            if (response.status === 429) {
              failures.push({
                model,
                code: '429',
                error: '429: Gemini rate limit; AI daily limit reached, resets 08:00 MYT',
              })
            } else {
              failures.push({ model, ...brief, error: redactSecrets(brief.error, apiKey) })
            }
            break
          }
          payload = JSON.parse(safe) as unknown
        } catch (error) {
          const message = redactSecrets(error instanceof Error ? error.message : 'Gemini transport error', apiKey)
          failures.push({ model, ...briefModelError(message) })
          break
        }
        const interpreted = interpretGemini(payload)
        if (interpreted.kind === 'tool') {
          if (!TOOL_DEFS.some((tool) => tool.name === interpreted.name)) {
            failures.push({ model, code: null, error: `unknown tool ${interpreted.name}` })
            break
          }
          const parsed = parseToolArgs(interpreted.name, asRecord(interpreted.args))
          if (!parsed.ok) {
            validationError = parsed.error
            failures.push({ model, ...briefModelError(parsed.error) })
            if (attempt === 0) continue
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
            break
          }
          return { type: 'text' as const, text: interpreted.text, model, attempts: modelAttemptNotes(failures) }
        }
        failures.push({ model, ...briefModelError(interpreted.detail) })
        break
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

/**
 * Workers AI first (gpt-oss-120b, then Llama 3.3), then Gemini when Workers AI
 * hits 4006, 5xx, or a timeout. Skip Gemini when GEMINI_API_KEY is missing.
 */
export function deskModelProvider(options: {
  ai: AiBinding
  primary?: string
  fallback?: string
  geminiApiKey?: string
  geminiModel?: string
  fetch?: typeof fetch
}): Provider {
  const workers = workersAiProvider(options.ai, { primary: options.primary, fallback: options.fallback })
  return {
    name: options.geminiApiKey ? 'workers-ai+gemini' : 'workers-ai',
    async next(ctx) {
      try {
        return await workers.next(ctx)
      } catch (error) {
        if (!(error instanceof MalformedModelOutput) || !options.geminiApiKey) throw error
        if (!shouldFallbackToGemini(error.attempts)) throw error
        const gemini = geminiProvider({
          apiKey: options.geminiApiKey,
          model: options.geminiModel,
          fetch: options.fetch,
        })
        try {
          const turn = await gemini.next(ctx)
          const prior = modelAttemptNotes(error.attempts)
          if (turn.type === 'tool' || turn.type === 'text') {
            return { ...turn, attempts: [...prior, ...(turn.attempts ?? [])] }
          }
          return turn
        } catch (geminiError) {
          const geminiFailures = geminiError instanceof MalformedModelOutput
            ? geminiError.attempts
            : [{
                model: options.geminiModel || GEMINI_DEFAULT_MODEL,
                code: null,
                error: geminiError instanceof Error ? geminiError.message : 'Gemini failed',
              }]
          const merged = [...error.attempts, ...geminiFailures]
          const summary = merged.map((failure) => `${failure.model}: ${failure.error}`).join('; ')
          throw new MalformedModelOutput(summary || 'Model providers failed.', merged)
        }
      }
    },
  }
}
