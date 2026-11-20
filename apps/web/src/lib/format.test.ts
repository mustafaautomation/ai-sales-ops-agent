import { describe, expect, it } from 'vitest'
import { cleanTranscript, stepTiming } from './format'

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
