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
