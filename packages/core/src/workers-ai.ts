import { trustedTranscript, type Provider } from './providers'
import type { PolicyContext } from './policy'
import { parseToolArgs, TOOL_NAMES, WORKERS_AI_TOOLS, type ToolName } from './tool-schemas'

export class MalformedModelOutput extends Error {
  attempts: { model: string; raw: unknown; error: string }[]
  constructor(message: string, attempts: { model: string; raw: unknown; error: string }[] = []) {
    super(message)
    this.name = 'MalformedModelOutput'
    this.attempts = attempts
  }
}

export const WORKERS_AI_PRIMARY = '@cf/openai/gpt-oss-120b'
export const WORKERS_AI_FALLBACK = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

export type AiBinding = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>
}

/**
 * Workers AI accepts two tool-call shapes.
 * Binding docs return `{ tool_calls: [{ name, arguments }] }`.
 * Chat-completions style models, including gpt-oss-120b, return
 * `choices[0].message.tool_calls[].function`.
 * Some gpt-oss replies put a JSON tool call in `content` instead.
 */
export function interpretWorkersAi(payload: unknown):
  | { kind: 'tool'; name: string; args: unknown }
  | { kind: 'text'; text: string }
  | { kind: 'malformed'; detail: string } {
  if (!payload || typeof payload !== 'object') return { kind: 'malformed', detail: 'empty model payload' }
  const record = payload as Record<string, unknown>
  const choice = (record.choices as { message?: Record<string, unknown>; finish_reason?: string }[] | undefined)?.[0]
  const message = choice?.message
  const openAiCall = (message?.tool_calls as { function?: { name?: string; arguments?: unknown } }[] | undefined)?.[0]?.function
  if (openAiCall?.name) return { kind: 'tool', name: openAiCall.name, args: parseArgs(openAiCall.arguments) }
  const legacy = (record.tool_calls as { name?: string; arguments?: unknown }[] | undefined)?.[0]
  if (legacy?.name) return { kind: 'tool', name: legacy.name, args: parseArgs(legacy.arguments) }
  const text = textOf(message?.content) || textOf(record.response)
  const embedded = text ? embeddedTool(text) : null
  if (embedded) return embedded
  if (text && text.trim()) return { kind: 'text', text: text.trim() }
  return { kind: 'malformed', detail: 'model returned neither a tool call nor text' }
}

function parseArgs(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return value
    }
  }
  return value ?? {}
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  return ''
}

function embeddedTool(text: string): { kind: 'tool'; name: string; args: unknown } | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { name?: string; arguments?: unknown }
    if (parsed.name && TOOL_NAMES.includes(parsed.name as ToolName)) {
      return { kind: 'tool', name: parsed.name, args: parseArgs(parsed.arguments) }
    }
  } catch {
    return null
  }
  return null
}

export type WorkersMessage = {
  role: string
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
  name?: string
}

/**
 * Chat Completions tool history, which both gpt-oss-120b and Llama 3.3 accept on Workers AI.
 * `/ai/run` detects a `messages` array. An assistant turn that called a tool is
 * `{ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments } }] }`.
 * The tool result is `{ role: 'tool', tool_call_id, name, content }`.
 * Assistant `content: null` plus `tool_call_id` round-trips were fixed in the Workers AI binding in February 2026.
 * Replaying "Called search_kb." as assistant text makes the model imitate that sentence instead of calling a tool.
 */
export function buildWorkersAiMessages(ctx: PolicyContext, nudge?: string): WorkersMessage[] {
  const transcript = trustedTranscript(ctx)
  const messages: WorkersMessage[] = [
    { role: 'system', content: transcript.system },
    { role: 'user', content: transcript.user },
  ]
  ctx.steps.forEach((step, index) => {
    if (!step.tool || step.status === 'error') return
    const callId = `call_${step.id ?? `${step.tool}_${index}`}`
    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: callId,
        type: 'function',
        function: { name: step.tool, arguments: JSON.stringify(step.args ?? {}) },
      }],
    })
    messages.push({
      role: 'tool',
      tool_call_id: callId,
      name: step.tool,
      content: JSON.stringify(step.result ?? {}).slice(0, 4000),
    })
  })
  const note = nudge || ctx.nudge
  if (note) messages.push({ role: 'user', content: note })
  return messages
}

export function workersAiProvider(ai: AiBinding, options?: { primary?: string; fallback?: string }): Provider {
  const primary = options?.primary || WORKERS_AI_PRIMARY
  const fallback = options?.fallback || WORKERS_AI_FALLBACK
  return {
    name: 'workers-ai',
    async next(ctx) {
      let lastDetail = 'no attempt'
      const rejected: { model: string; raw: unknown; error: string }[] = []
      for (const model of [primary, fallback]) {
        let validationError = ''
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const nudge = [
            ctx.nudge,
            validationError
              ? `The previous tool call was rejected: ${validationError}. Call the tool again with valid JSON. lines must be an array of objects with sku and qty, not a JSON string. Do not answer in prose.`
              : '',
          ].filter(Boolean).join('\n\n')
          let payload: unknown
          try {
            payload = await ai.run(model, {
              messages: buildWorkersAiMessages(ctx, nudge || undefined),
              tools: WORKERS_AI_TOOLS,
            })
          } catch (error) {
            lastDetail = error instanceof Error ? error.message : 'transport error'
            break
          }
          const interpreted = interpretWorkersAi(payload)
          if (interpreted.kind === 'tool') {
            if (!TOOL_NAMES.includes(interpreted.name as ToolName)) {
              lastDetail = `unknown tool ${interpreted.name}`
              break
            }
            const parsed = parseToolArgs(interpreted.name, asRecord(interpreted.args))
            if (!parsed.ok) {
              validationError = parsed.error
              lastDetail = parsed.error
              rejected.push({ model, raw: interpreted.args, error: parsed.error })
              if (attempt === 0) continue
              break
            }
            return { type: 'tool' as const, name: interpreted.name as ToolName, args: parsed.data, model, rejected }
          }
          if (interpreted.kind === 'text') return { type: 'text' as const, text: interpreted.text, model }
          lastDetail = interpreted.detail
          break
        }
      }
      throw new MalformedModelOutput(`Workers AI tool call was malformed (${lastDetail}).`, rejected)
    },
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return { value }
}
