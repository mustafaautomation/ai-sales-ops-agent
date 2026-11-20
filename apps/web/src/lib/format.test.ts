import { describe, expect, it } from 'vitest'
import { auditEventLabel, cleanTranscript, deskWhen, humanizeAction, readStepResult, span, stepTiming, when } from './format'

describe('step timing', () => {
  it('uses the step’s own start and finish, and keeps the approval wait separate', () => {
    const timing = stepTiming({ startedAt: 0, finishedAt: 50, approvalDecidedAt: 10_000 })
    expect(timing.own).toBe('50 ms')
    expect(timing.wait).toBe('9.9 s')
  })

  it('does not treat the gap until the next model call as this step’s duration', () => {
    const timing = stepTiming({ startedAt: 1_000, finishedAt: 1_050, approvalDecidedAt: null })
    expect(timing.own).toBe('50 ms')
    expect(timing.wait).toBeNull()
  })

  it('hides sub-millisecond durations', () => {
    expect(span(0)).toBeNull()
    expect(span(0.4)).toBeNull()
    expect(span(1.2)).toBe('1 ms')
    expect(span(1200)).toBe('1.2 s')
  })
})

describe('audit labels', () => {
  it('turns tool and approval events into readable sentences', () => {
    expect(auditEventLabel({ action: 'approval.approved', detail: JSON.stringify({ tool: 'send_email', quoteNumber: 'MF-1003' }) }))
      .toBe('Quote email approved for MF-1003')
    expect(auditEventLabel({ action: 'tool.completed', detail: JSON.stringify({ tool: 'crm_upsert' }) }))
      .toBe('CRM record updated')
    expect(auditEventLabel({ action: 'optin.sent', detail: JSON.stringify({ email: 'm***@gmail.com' }) }))
      .toBe('Opt-in email sent to m***@gmail.com')
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
    expect(when(stamp)).toContain('MYT')
    expect(deskWhen(stamp)).toContain('MYT')
    expect(when(stamp, 'UTC')).toContain('UTC')
  })
})
