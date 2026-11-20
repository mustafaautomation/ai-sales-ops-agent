import { describe, expect, it } from 'vitest'
import { cleanTranscript, deskWhen, humanizeAction, readStepResult, stepTiming, when } from './format'

describe('step timing', () => {
  it('uses the step’s own start and finish, and keeps the approval wait separate', () => {
    const timing = stepTiming({ startedAt: 0, finishedAt: 50, approvalDecidedAt: 10_000 })
    expect(timing.own).toBe('50ms')
    expect(timing.wait).toBe('9.9s')
  })

  it('does not treat the gap until the next model call as this step’s duration', () => {
    const timing = stepTiming({ startedAt: 1_000, finishedAt: 1_050, approvalDecidedAt: null })
    expect(timing.own).toBe('50ms')
    expect(timing.wait).toBeNull()
  })
})

describe('call transcript', () => {
  it('unwraps JSON quotes and literal newlines', () => {
    expect(cleanTranscript('"Hello\\nthere"')).toBe('Hello\nthere')
    expect(cleanTranscript('line one\\nline two')).toBe('line one\nline two')
    expect(cleanTranscript('already clean')).toBe('already clean')
  })
})

describe('run step results', () => {
  it('treats missing and JSON null results as empty objects', () => {
    expect(readStepResult(null)).toEqual({})
    expect(readStepResult(undefined)).toEqual({})
    expect(readStepResult('null')).toEqual({})
    expect(readStepResult('{"fallback":true}').fallback).toBe(true)
  })
})

describe('desk labels and times', () => {
  it('humanizes optin.sent for the activity feed', () => {
    expect(humanizeAction('optin.sent')).toBe('Opt-in sent')
  })

  it('formats outbox times in the desk timezone', () => {
    const stamp = Date.UTC(2026, 10, 20, 0, 30)
    expect(when(stamp)).toContain('UTC')
    expect(deskWhen(stamp)).toContain('MYT')
    expect(deskWhen(stamp)).not.toContain('UTC')
  })
})
