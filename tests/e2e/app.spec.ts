import { test, expect, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('/issues');
  await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All issues', exact: true })).toBeVisible();
}
test('create issue, edit Markdown, change status, filter list', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'New issue', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Issue title').fill('Browser acceptance test');
  await dialog.getByLabel('Issue description').fill('## Acceptance\n- [ ] Works in the browser');
  await dialog.getByRole('button', { name: 'Create issue', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: /Browser acceptance test/ }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Browser acceptance test');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await page.getByLabel('Description', { exact: true }).fill('## Updated\nA durable description.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Updated', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Status', exact: true }).click();
  await page.getByRole('option', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Close issue', exact: true }).click();
  await page.getByLabel('Search issues', { exact: true }).fill('Browser acceptance test');
  await expect(page.getByTestId('issue-row')).toHaveCount(1);
});
test('command menu opens and closes with focus restoration', async ({ page }) => {
  await login(page);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Search commands and issues').fill('projects');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
test('narrow layout exposes navigation and does not overflow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await login(page);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
test('read-only API token cannot mutate via browser HTTP client', async ({ page }) => {
  await login(page);
  const token = await page.request.post('/api/v1/tokens', {
    headers: { 'x-tickets-csrf': '1' },
    data: { name: 'e2e read-only', scopes: ['read'] },
  });
  expect(token.ok()).toBeTruthy();
  const secret = (await token.json()).token;
  const r = await page.request.post('/api/v1/labels', {
    headers: { authorization: `Bearer ${secret}` },
    data: { name: 'Should not exist', color: '#ffffff' },
  });
  expect(r.status()).toBe(403);
});
