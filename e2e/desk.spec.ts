import { DatabaseSync } from 'node:sqlite'
import { expect, test } from '@playwright/test'
import { signDeskToken } from '../packages/core/src/outbound'

test('an inquiry is quoted, approved, sent, and written to the CRM', async ({ page }) => {
  const company = `Annex ${Date.now()}`
  await page.goto('/inquire')
  await page.getByLabel('Name').fill('Jordan Hale')
  await page.getByLabel('Work email').fill('jordan.hale@annex-trial.example')
  await page.getByLabel('Company').fill(company)
  await page.getByLabel('Subject').fill('Nightly cleaning')
  await page.getByLabel('What do you need?').fill('Please quote nightly cleaning for 8,000 sqft and 2 restrooms. Annual contract.')
  await page.getByRole('button', { name: 'Submit inquiry' }).click()
  await expect(page.getByText('Inquiry received')).toBeVisible()

  await page.goto('/login')
  await page.getByRole('button', { name: 'Enter demo workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()

  await page.goto('/inbox')
  await page.getByRole('link', { name: company }).click()
  await page.getByRole('link', { name: 'Open run' }).click()
  await expect(page.getByText('draft_quote').first()).toBeVisible()
  await expect(page.getByText('awaiting approval').first()).toBeVisible()
  await expect(page.getByText('Logged arguments and results are redacted.')).toHaveCount(1)
  await page.getByText('Arguments').first().click()
  const sidebar = await page.locator('.sidebar').evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    viewport: window.innerHeight,
    scroll: document.documentElement.scrollHeight,
  }))
  expect(sidebar.height).toBeGreaterThanOrEqual(sidebar.viewport - 1)
  expect(sidebar.height + 1).toBeGreaterThanOrEqual(sidebar.scroll)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  }

  await page.getByRole('link', { name: 'Review approval' }).click()
  await expect(page.getByRole('heading', { name: 'crm_upsert' })).toBeVisible()
  await expect(page.locator('.fields dt', { hasText: 'Company' })).toBeVisible()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByRole('link', { name: 'Review approval' })).toBeVisible()

  await page.getByRole('link', { name: 'Review approval' }).click()
  await expect(page.getByRole('heading', { name: 'send_email' })).toBeVisible()
  const preview = page.locator('.email-preview')
  await expect(preview).toBeVisible()
  expect(await preview.innerText()).not.toContain('\\n')
  await expect(preview).toContainText('Hello')
  await page.setViewportSize({ width: 390, height: 900 })
  const approvalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(approvalOverflow).toBeLessThanOrEqual(1)
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(page.getByText('Raw payload')).toBeVisible()
  await page.getByText('Raw payload').click()
  const stored = JSON.parse(await page.locator('#payload').inputValue()) as { body: string }
  expect(stored.body).toContain('/unsubscribed?token=')
  expect(stored.body).not.toContain('The notes do not cover this.')
  const main = stored.body
    .split('\nSources:\n')[0]
    .replace(/\n*To stop all contact:\s*\S+\s*$/i, '')
    .replace(/\n*Meridian Facilities sales desk\nCedarhaven\s*$/, '')
  const paragraphs = main.split(/\n\n+/).map((part) => part.replace(/\s+/g, ' ').trim()).filter((part) => part.length > 12)
  const shown = (await page.locator('.email-body').innerText()).replace(/\s+/g, ' ')
  let cursor = 0
  for (const paragraph of paragraphs) {
    const at = shown.indexOf(paragraph.slice(0, 24), cursor)
    expect(at).toBeGreaterThanOrEqual(cursor)
    cursor = at + 1
  }
  await expect(page.locator('.signoff')).toContainText('Meridian Facilities sales desk')
  if (/\n\d+\.\s/.test(stored.body)) {
    await expect(page.locator('.sources')).toBeVisible()
    await expect(page.locator('.sources')).not.toContainText('Cedarhaven')
    await expect(page.locator('.sources')).not.toContainText('Meridian Facilities sales desk')
  }
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText(/Quote MF-\d+ was sent after approval/)).toBeVisible()

  await page.goto('/quotes')
  await expect(page.getByRole('row', { name: new RegExp(company) })).toContainText(/sent/i)

  await page.goto(`/inbox`)
  await page.getByRole('link', { name: company }).click()
  await expect(page.getByRole('heading', { name: 'Classification' })).toBeVisible()
  await expect(page.locator('.letter')).toBeVisible()

  await page.getByRole('button', { name: 'Theme' }).click()
  const colors = await page.evaluate(() => ({
    side: getComputedStyle(document.querySelector('.sidebar') as HTMLElement).backgroundColor,
    page: getComputedStyle(document.body).backgroundColor,
  }))
  expect(colors.side).not.toBe(colors.page)

  await page.setViewportSize({ width: 390, height: 800 })
  const nav = page.locator('nav.nav')
  await nav.evaluate((element) => { element.scrollLeft = element.scrollWidth })
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()

  await page.goto('/crm')
  await expect(page.getByText(company).first()).toBeVisible()
  await expect(page.getByText('1 contact').first()).toBeVisible()
  const amount = page.locator('.money').first()
  await expect(amount).toBeVisible()
  expect(await amount.innerText()).toMatch(/\d\.\d{2}/)
  const font = await amount.evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase())
  expect(font).toMatch(/mono|plex|jetbrains|ui-monospace/)
})

test('opt-in and unsubscribe links open without a login', async ({ page }) => {
  const exp = Date.now() + 60 * 60 * 1000
  const confirmToken = await signDeskToken('e2e-session-secret', { inquiryId: 'inq_e2e', email: 'jordan@annex-trial.example', purpose: 'opt-in', exp })
  await page.goto(`/confirm?token=${encodeURIComponent(confirmToken)}`)
  await expect(page.getByRole('heading', { name: "You're confirmed" })).toBeVisible()
  await expect(page).not.toHaveURL(/\/login/)
  await page.goto(`/confirm?token=${encodeURIComponent(confirmToken)}`)
  await expect(page.getByRole('heading', { name: "You're confirmed" })).toBeVisible()
  const stopToken = await signDeskToken('e2e-session-secret', { inquiryId: 'inq_e2e', email: 'jordan@annex-trial.example', purpose: 'unsubscribe', exp })
  await page.goto(`/unsubscribed?token=${encodeURIComponent(stopToken)}`)
  await expect(page.getByRole('heading', { name: 'You are unsubscribed' })).toBeVisible()
  await expect(page).not.toHaveURL(/\/login/)
  await page.goto('/login')
  await page.getByRole('button', { name: 'Enter demo workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
  await page.context().clearCookies()
  const db = new DatabaseSync('/tmp/meridian-e2e.db', { readOnly: true })
  const lead = db.prepare(`SELECT id, from_email, subject FROM inquiries WHERE external_id = 'e_north'`).get() as { id: string; from_email: string; subject: string }
  db.close()
  const callToken = await signDeskToken('e2e-session-secret', { inquiryId: lead.id, email: lead.from_email, purpose: 'call', exp })
  await page.goto(`/call/${encodeURIComponent(callToken)}`)
  await expect(page.getByText('Priya Shah')).toBeVisible()
  await expect(page.getByText(lead.subject)).toBeVisible()
  await expect(page).not.toHaveURL(/\/login/)
})

test('the public line does not claim a short-lived token before a session exists', async ({ page }) => {
  await page.goto('/call')
  await expect(page.getByRole('heading', { name: 'Call our sales line' })).toBeVisible()
  await expect(page.getByText('short-lived token')).toHaveCount(0)
  await expect(page.getByText('This line uses the public key for this site.')).toBeVisible()
})

test('a rate-limited inquiry is not added to the inbox', async ({ page }) => {
  const db = new DatabaseSync('/tmp/meridian-e2e.db')
  const now = Date.now()
  for (const key of ['form:127.0.0.1', 'form:local', 'form:::1']) {
    db.prepare('INSERT INTO rate_buckets (bucket_key, window_start, count) VALUES (?, ?, 5) ON CONFLICT(bucket_key) DO UPDATE SET window_start = excluded.window_start, count = 5').run(key, now)
  }
  db.close()
  const company = `Blocked ${Date.now()}`
  await page.goto('/inquire')
  await page.getByLabel('Name').fill('Jordan Hale')
  await page.getByLabel('Work email').fill('jordan.hale@blocked-trial.example')
  await page.getByLabel('Company').fill(company)
  await page.getByLabel('Subject').fill('Nightly cleaning')
  await page.getByLabel('What do you need?').fill('Please quote nightly cleaning for 8,000 sqft.')
  await page.getByRole('button', { name: 'Submit inquiry' }).click()
  await expect(page.getByText(/Too many inquiries/)).toBeVisible()
  await page.goto('/login')
  await page.getByRole('button', { name: 'Enter demo workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
  await page.goto('/inbox')
  await expect(page.getByRole('link', { name: company })).toHaveCount(0)
})

test('a browser call is stored against the lead', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Enter demo workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
  const db = new DatabaseSync('/tmp/meridian-e2e.db', { readOnly: true })
  const lead = db.prepare(`SELECT id, from_email, subject FROM inquiries WHERE external_id = 'e_north'`).get() as { id: string; from_email: string; subject: string }
  db.close()
  const exp = Date.now() + 60 * 60 * 1000
  const token = await signDeskToken('e2e-session-secret', { inquiryId: lead.id, email: lead.from_email, purpose: 'call', exp })
  const linked = await page.request.post('/api/voice/link', { data: { token, vapiCallId: 'call_web_e2e' } })
  expect(linked.ok()).toBeTruthy()
  await page.context().clearCookies()
  await page.goto(`/call/${encodeURIComponent(token)}`)
  await expect(page.getByRole('button', { name: 'Call our sales line' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'End call' })).toHaveCount(0)
  await page.goto('/login')
  await page.getByRole('button', { name: 'Enter demo workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
  await page.goto('/calls')
  await page.getByRole('link', { name: 'North Wharf Logistics' }).click()
  await expect(page.getByText('Call web e2e')).toBeVisible()
  await expect(page.getByRole('link', { name: new RegExp(lead.subject) })).toBeVisible()
  await expect(page.getByText('CALL_WEB_E2E')).toHaveCount(0)
})

test('a blocked send is described as not sent', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Enter demo workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
  const db = new DatabaseSync('/tmp/meridian-e2e.db')
  const now = Date.now()
  db.prepare(
    `INSERT INTO inquiries (id, source, external_id, from_name, from_email, company_name, subject, body, status, intent, injection_flag, created_at, updated_at)
     VALUES ('inq_blocked_view', 'web', 'web:inq_blocked_view', 'Elena Marsh', 'elena@blocked-view.example', 'West Cedar Dental', 'Blocked quote', 'Please quote.', 'resolved', 'quote', 0, ?, ?)`,
  ).run(now, now)
  db.prepare(
    `INSERT INTO agent_runs (id, inquiry_id, status, provider, disposition, summary, error, started_at, finished_at)
     VALUES ('run_blocked_view', 'inq_blocked_view', 'completed', 'workers-ai', 'completed', 'Quote MF-1104 was not sent. Real sending is off.', NULL, ?, ?)`,
  ).run(now, now)
  db.close()
  await page.goto('/runs/run_blocked_view')
  await expect(page.getByText('Quote MF-1104 was not sent. Real sending is off.')).toBeVisible()
  await expect(page.getByText('was sent after approval')).toHaveCount(0)
})

test('a mocked sales call shows up in the calls view', async ({ page }) => {
  const response = await page.request.post('/api/vapi/events', {
    headers: { 'x-vapi-secret': 'local-vapi-secret' },
    data: {
      company: 'Lantern Hall',
      callerName: 'Noor Haddad',
      summary: 'Asked about a day porter.',
      message: { type: 'end-of-call-report', summary: 'Asked about a day porter.', endedReason: 'customer-ended-call', call: { id: 'call_e2e' }, transcript: 'day porter' },
    },
  })
  expect(response.ok()).toBeTruthy()
  await page.goto('/login')
  await page.getByRole('button', { name: 'Enter demo workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
  await page.goto('/calls')
  await expect(page.getByText('Asked about a day porter.')).toBeVisible()
  await page.getByRole('link', { name: 'Lantern Hall' }).click()
  await expect(page.getByText('day porter')).toBeVisible()
})
