#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'apps/web/src/generated')
const outFile = join(outDir, 'repo-stats.json')

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.next' || entry.name === 'data') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, acc)
    else acc.push(path)
  }
  return acc
}

const files = walk(root)
const unitFiles = files.filter((path) => /\.test\.ts$/.test(path) && !path.includes('.contract.test.'))
let unitTests = 0
for (const file of unitFiles) {
  const text = readFileSync(file, 'utf8')
  unitTests += [...text.matchAll(/\bit\s*\(/g)].length
}

const scenariosPath = join(root, 'evals/scenarios.ts')
const scenariosText = readFileSync(scenariosPath, 'utf8')
const evalScenarios = [...scenariosText.matchAll(/^\s*id:\s*['"`]/gm)].length

const stats = {
  generatedAt: new Date().toISOString(),
  unitFiles: unitFiles.length,
  unitTests,
  evalScenarios,
  unitFilePaths: unitFiles.map((path) => relative(root, path)).sort(),
}

mkdirSync(outDir, { recursive: true })
writeFileSync(outFile, `${JSON.stringify(stats, null, 2)}\n`)
console.log(`Wrote ${relative(root, outFile)} (${unitFiles.length} files, ${unitTests} tests, ${evalScenarios} evals)`)
