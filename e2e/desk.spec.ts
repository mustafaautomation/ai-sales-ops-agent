import { expect, test } from '@playwright/test'

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
  await expect(page.getByText('Raw payload')).toBeVisible()
  await page.getByText('Raw payload').click()
  const stored = JSON.parse(await page.locator('#payload').inputValue()) as { body: string }
  const main = stored.body.split('\nSources:\n')[0]
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

test('the public line does not claim a short-lived token before a session exists', async ({ page }) => {
  await page.goto('/call')
  await expect(page.getByRole('heading', { name: 'Call our sales line' })).toBeVisible()
  await expect(page.getByText('short-lived token')).toHaveCount(0)
  await expect(page.getByText('This line uses the public key for this site.')).toBeVisible()
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
