import { trustedTranscript, type Provider } from './providers'
import type { PolicyContext } from './policy'
import { TOOL_NAMES, WORKERS_AI_TOOLS, type ToolName } from './tool-schemas'

export class MalformedModelOutput extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MalformedModelOutput'
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

function messagesFor(ctx: PolicyContext): { role: string; content: string }[] {
  const transcript = trustedTranscript(ctx)
  const messages = [
    { role: 'system', content: transcript.system },
    { role: 'user', content: transcript.user },
  ]
  for (const step of ctx.steps) {
    if (!step.tool) continue
    messages.push({ role: 'assistant', content: `Called ${step.tool}.` })
    messages.push({ role: 'tool', content: JSON.stringify(step.result).slice(0, 4000) })
  }
  return messages
}

export function workersAiProvider(ai: AiBinding, options?: { primary?: string; fallback?: string }): Provider {
  const primary = options?.primary || WORKERS_AI_PRIMARY
  const fallback = options?.fallback || WORKERS_AI_FALLBACK
  return {
    name: 'workers-ai',
    async next(ctx) {
      let lastDetail = 'no attempt'
      for (const model of [primary, fallback]) {
        const payload = await ai.run(model, {
          messages: messagesFor(ctx),
          tools: WORKERS_AI_TOOLS,
        })
        const interpreted = interpretWorkersAi(payload)
        if (interpreted.kind === 'tool') {
          if (!TOOL_NAMES.includes(interpreted.name as ToolName)) {
            lastDetail = `unknown tool ${interpreted.name}`
            continue
          }
          return { type: 'tool', name: interpreted.name as ToolName, args: asRecord(interpreted.args) }
        }
        if (interpreted.kind === 'text') {
          return { type: 'final', disposition: 'completed', summary: interpreted.text }
        }
        lastDetail = interpreted.detail
      }
      throw new MalformedModelOutput(`Workers AI tool call was malformed (${lastDetail}).`)
    },
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return { value }
}
