import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const children = []

function start(args) {
  const child = spawn('pnpm', args, { stdio: 'inherit', env: process.env })
  children.push(child)
  child.on('exit', (code) => {
    if (code) shutdown(code)
  })
}

async function wait(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // still starting
    }
    await delay(250)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function shutdown(code = 0) {
  for (const child of children) child.kill('SIGTERM')
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

process.env.EMAIL_API_URL ||= 'http://127.0.0.1:4001'
process.env.CRM_API_URL ||= 'http://127.0.0.1:4002'
process.env.LLM_PROVIDER ||= 'mock'
process.env.DEMO_MODE ||= 'true'
process.env.SESSION_SECRET ||= 'dev-only-session-secret'

start(['--filter', '@meridian/email-api', 'dev'])
start(['--filter', '@meridian/crm-api', 'dev'])
await wait(process.env.EMAIL_API_URL + '/health')
await wait(process.env.CRM_API_URL + '/health')
start(['--filter', '@meridian/web', 'dev'])
