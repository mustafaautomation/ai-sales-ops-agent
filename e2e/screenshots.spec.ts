import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { OPERATOR } from '../packages/core/src/auth'

const dir = 'docs/screenshots'

async function shot(page: import('@playwright/test').Page, name: string) {
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: `${dir}/${name}.png`, animations: 'disabled' })
}

test('capture the desk in light and dark', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.request.post('/api/vapi/events', {
    headers: { 'x-vapi-secret': 'local-vapi-secret' },
    data: {
      company: 'Lantern Hall',
      callerName: 'Noor Haddad',
      summary: 'Asked about a day porter.',
      message: { type: 'end-of-call-report', summary: 'Asked about a day porter.', endedReason: 'customer-ended-call', call: { id: 'call_shot' }, transcript: 'day porter for the lobby' },
    },
  })

  await page.goto('/')
  await shot(page, 'landing-light')

  await page.goto('/login')
  await page.getByLabel('Email').fill(OPERATOR.email)
  await page.getByLabel('Password').fill(OPERATOR.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()

  const light = [
    ['/overview', 'overview-light'],
    ['/inbox', 'inbox-light'],
    ['/approvals', 'approvals-light'],
    ['/quotes', 'quotes-light'],
    ['/crm', 'crm-light'],
    ['/kb', 'kb-light'],
    ['/audit', 'audit-light'],
    ['/settings', 'settings-light'],
    ['/calls', 'calls-light'],
  ] as const

  for (const [path, name] of light) {
    await page.goto(path)
    await page.waitForTimeout(200)
    await shot(page, name)
  }

  await page.goto('/inbox')
  await page.getByRole('link', { name: 'North Wharf Logistics' }).click()
  await page.getByRole('link', { name: 'Open run' }).click()
  await expect(page.locator('.timeline, .t-card, .empty-state').first()).toBeVisible()
  await shot(page, 'run-light')

  await page.goto('/quotes')
  const quoteLink = page.locator('table a, a').filter({ hasText: /MF-\d+/ }).first()
  await quoteLink.click()
  await expect(page.locator('h1').first()).toBeVisible()
  await shot(page, 'quote-light')

  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
    localStorage.setItem('theme', 'dark')
  })

  const dark = [
    ['/overview', 'overview-dark'],
    ['/inbox', 'inbox-dark'],
    ['/approvals', 'approvals-dark'],
    ['/crm', 'crm-dark'],
    ['/kb', 'kb-dark'],
    ['/settings', 'settings-dark'],
    ['/calls', 'calls-dark'],
  ] as const
  for (const [path, name] of dark) {
    await page.goto(path)
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark'
    })
    await page.waitForTimeout(150)
    await shot(page, name)
  }

  await page.goto('/quotes')
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
  })
  await page.getByRole('link').filter({ hasText: /MF-\d+/ }).first().click()
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
  })
  await shot(page, 'quote-dark')
})
