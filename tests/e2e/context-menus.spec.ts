import { test, expect, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
}
test('issue right-click and visible ellipsis use identical context actions', async ({ page }) => {
  await login(page); const row = page.getByTestId('issue-row').first();
  await row.click({ button: 'right' });
  const menu = page.getByRole('menu').first(); await expect(menu).toBeVisible();
  const labels = await menu.getByRole('menuitem').allTextContents();
  await expect(menu.getByRole('menuitem', { name: 'Open issue', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('menu')).toHaveCount(0);
  await row.locator('..').getByRole('button', { name: /^Actions for / }).click();
  await expect(page.getByRole('menu').first()).toBeVisible();
  expect(await page.getByRole('menu').first().getByRole('menuitem').allTextContents()).toEqual(labels);
  await page.keyboard.press('Escape');
  await expect(row.locator('..').getByRole('button', { name: /^Actions for / })).toBeFocused();
});
test('team menu is reachable by ellipsis and Shift+F10 without navigating', async ({ page }) => {
  await login(page); const row = page.locator('.team-context-row').first();
  await row.getByRole('button', { name: /^Actions for / }).click();
  await expect(page.getByRole('menuitem', { name: 'Open team issues', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await row.locator('.nav-item').focus(); await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Open team issues', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page).toHaveURL(/\/issues$/);
});
test('copy submenu provides identifiers and Markdown; selected text keeps the native menu', async ({ page }) => {
  await login(page); const row = page.getByTestId('issue-row').first();
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).hover();
  await expect(page.getByRole('menuitem', { name: 'Copy issue ID', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Copy Markdown', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('menu')).toHaveCount(1);
  await page.keyboard.press('Escape'); await expect(page.getByRole('menu')).toHaveCount(0);
  await row.locator('.issue-open > span').evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); });
  await row.locator('.issue-open > span').dispatchEvent('contextmenu', { bubbles: true });
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(await page.evaluate(() => window.getSelection()?.toString().length)).toBeGreaterThan(0);
});
test('document list menus offer copy and permission-aware archive without opening the object', async ({ page }) => {
  await login(page);
  const result = await page.request.post('/api/v1/documents', { headers: { 'x-tickets-csrf': '1' }, data: { title: 'Context-menu document', body: 'Preserved source text' } });
  expect(result.status()).toBe(201); await page.goto('/documents');
  const row = page.locator('.knowledge-context-row').filter({ hasText: 'Context-menu document' }).first();
  await row.locator('.knowledge-row').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Open document', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Archive document', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page).toHaveURL(/\/documents$/);
});
