import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'

const dbPath = process.env.DATABASE_PATH || '/tmp/meridian-e2e.db'
rmSync(dbPath, { force: true })
rmSync(`${dbPath}-wal`, { force: true })
rmSync(`${dbPath}-shm`, { force: true })

const child = spawn('pnpm', ['--filter', '@meridian/web', 'start'], {
  stdio: 'inherit',
  env: process.env,
})

child.on('exit', (code) => process.exit(code ?? 0))
process.on('SIGTERM', () => child.kill('SIGTERM'))
process.on('SIGINT', () => child.kill('SIGINT'))
