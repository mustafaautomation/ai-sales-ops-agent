import { defineConfig, devices } from '@playwright/test'

const env = {
  ...process.env,
  DATABASE_PATH: '/tmp/meridian-e2e.db',
  EMAIL_API_URL: 'http://127.0.0.1:4001',
  CRM_API_URL: 'http://127.0.0.1:4002',
  LLM_PROVIDER: 'mock',
  DEMO_MODE: 'true',
  SESSION_SECRET: 'e2e-session-secret',
}

export default defineConfig({
  testDir: 'e2e',
  testIgnore: process.env.SCREENSHOTS ? undefined : ['**/screenshots.spec.ts'],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'pnpm --filter @meridian/email-api start', port: 4001, reuseExistingServer: false, env: { ...env, PORT: '4001' } },
    { command: 'pnpm --filter @meridian/crm-api start', port: 4002, reuseExistingServer: false, env: { ...env, PORT: '4002' } },
    {
      command: 'node scripts/e2e-web.mjs',
      port: 3000,
      reuseExistingServer: false,
      timeout: 180_000,
      env,
    },
  ],
})
