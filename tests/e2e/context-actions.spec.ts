import { test, expect } from '@playwright/test';
async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByLabel('Password', { exact: true }).press('Enter');
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
}
test('team ellipsis and context menu expose identical actions', async ({ page }) => {
  await login(page);
  const row = page.locator('.team-navigation-row').first();
  await row.getByRole('button', { name: /Actions for / }).click();
  const visible = await page.getByRole('menuitem').allTextContents();
  await expect(page.getByRole('menuitem', { name: 'Open team issues', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await row.locator('.nav-item').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Open team issues', exact: true })).toBeVisible();
  expect(await page.getByRole('menuitem').allTextContents()).toEqual(visible);
  await page.keyboard.press('Escape');
  await row.locator('.nav-item').focus();
  await page.keyboard.press('Shift+F10');
  await expect(
    page.getByRole('menuitem', { name: 'Hide from sidebar', exact: true }),
  ).toBeVisible();
});
test('hiding a team is reversible and never deletes workspace data', async ({ page }) => {
  await login(page);
  const row = page.locator('.team-navigation-row').first();
  const name = await row.locator('.nav-item').innerText();
  let writes = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method())) writes++;
  });
  await row.getByRole('button', { name: /Actions for / }).click();
  await page.getByRole('menuitem', { name: 'Hide from sidebar', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Show hidden teams (1)', exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Show hidden teams (1)', exact: true }).click();
  const hidden = page
    .locator('.team-navigation-row')
    .filter({ hasText: name.split('\n').at(-1) })
    .first();
  await hidden.getByRole('button', { name: /Actions for / }).click();
  await page.getByRole('menuitem', { name: 'Show in sidebar', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Show hidden teams (1)', exact: true }),
  ).toHaveCount(0);
  expect(writes).toBe(0);
});
test('a team menu creates a draft with that team without creating an issue', async ({ page }) => {
  await login(page);
  const row = page.locator('.team-navigation-row').first();
  await row.getByRole('button', { name: /Actions for / }).click();
  await page.getByRole('menuitem', { name: 'Create issue in team', exact: true }).click();
  await expect(page).toHaveURL(/\/issues\/new$/);
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('');
});
