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

  await page.getByRole('link', { name: 'Review approval' }).click()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByRole('link', { name: 'Review approval' })).toBeVisible()

  await page.getByRole('link', { name: 'Review approval' }).click()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText(/Quote MF-/)).toBeVisible()

  await page.goto('/quotes')
  await expect(page.getByRole('row', { name: new RegExp(company) })).toContainText(/sent/i)

  await page.goto('/crm')
  await expect(page.getByText(company).first()).toBeVisible()
})

test('the public line does not claim a short-lived token before a session exists', async ({ page }) => {
  await page.goto('/call')
  await expect(page.getByRole('heading', { name: 'Call our sales line' })).toBeVisible()
  await expect(page.getByText('short-lived token')).toHaveCount(0)
  await expect(page.getByText('The line answers from the notes and the rate card.')).toBeVisible()
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
