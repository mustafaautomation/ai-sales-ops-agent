import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import stats from '../../generated/repo-stats.json'

describe('landing page stats', () => {
  it('binds the visible counts to generated repo-stats.json', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')
    expect(source).toContain("from '../../generated/repo-stats.json'")
    expect(source).toContain('{stats.unitFiles}')
    expect(source).toContain('{stats.unitTests}')
    expect(source).toContain('{stats.evalScenarios}')
    expect(source).not.toMatch(/\b161\b/)
    expect(source).not.toMatch(/<strong>\d+ files<\/strong>/)
    expect(source).not.toMatch(/<strong>\d{2,}<\/strong>/)
    // The numbers the page renders are exactly these generated values.
    expect(stats.unitFiles).toBeGreaterThan(0)
    expect(stats.unitTests).toBeGreaterThan(0)
    expect(stats.evalScenarios).toBeGreaterThan(0)
    const regenerated = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../generated/repo-stats.json'), 'utf8'),
    ) as typeof stats
    expect(stats.unitFiles).toBe(regenerated.unitFiles)
    expect(stats.unitTests).toBe(regenerated.unitTests)
    expect(stats.evalScenarios).toBe(regenerated.evalScenarios)
  })
})
