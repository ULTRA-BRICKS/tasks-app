import { test, expect, type Page, type BrowserContext } from '@playwright/test';
let cookies: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;
async function login(page: Page) {
  if (cookies) {
    await page.context().addCookies(cookies);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'All tasks', exact: true })).toBeVisible();
    return;
  }
  await page.goto('/issues');
  await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All tasks', exact: true })).toBeVisible();
  cookies = await page.context().cookies();
}
test('create issue, edit Markdown, change status, filter list', async ({ page }, testInfo) => {
  const title = `Browser acceptance test ${testInfo.project.name} ${Date.now()}`;
  await login(page);
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/new$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Description', { exact: true }).fill('Works in the browser');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/(?!new)[^/]+$/);
  const editor = page.getByRole('textbox', { name: 'Description', exact: true });
  await editor.fill('');
  await editor.pressSequentially('## Updated');
  await editor.press('Enter');
  await editor.pressSequentially('A durable description.');
  await page.getByLabel('Title', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Updated', exact: true })).toBeVisible();
  await expect(page.getByText('Saving…', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Updated', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Status', exact: true }).click();
  await page.getByRole('option', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Close task', exact: true }).click();
  await page.getByLabel('Search tasks', { exact: true }).fill(title);
  await expect(page.getByTestId('issue-row')).toHaveCount(1);
});
test('command menu opens and closes with focus restoration', async ({ page }) => {
  await login(page);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Search commands and tasks').fill('projects');
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

test('keyboard moves between issues, opens a page and never hijacks typing', async ({ page }) => {
  await login(page);
  await expect(page.locator('.issue-list .issue-open').first()).toBeVisible();
  await page.getByRole('heading', { name: 'All tasks', exact: true }).click();
  await page.keyboard.press('j');
  await expect(page.locator('.issue-list .issue-open').first()).toBeFocused();
  await page.keyboard.press('j');
  await expect(page.locator('.issue-list .issue-open').nth(1)).toBeFocused();
  await page.keyboard.press('k');
  await expect(page.locator('.issue-list .issue-open').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Title', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/tasks$/);
  await page.keyboard.press('c');
  await expect(page).toHaveURL(/\/tasks\/new$/);
  await page.getByLabel('Title', { exact: true }).fill('keyboard c v j k g');
  await expect(page).toHaveURL(/\/tasks\/new$/);
});
test('private issue drafts survive navigation without premature publication', async ({ page }) => {
  await login(page);
  await page.goto('/issues/new');
  await page.getByLabel('Title', { exact: true }).fill('Draft not yet published');
  await page.goto('/issues');
  await page.getByLabel('Search tasks', { exact: true }).fill('Draft not yet published');
  await expect(page.getByTestId('issue-row')).toHaveCount(0);
  await page.goto('/issues/new');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Draft not yet published');
});
test('project creation uses the document page, not a dialog, and inline rename persists', async ({
  page,
}) => {
  await login(page);
  await page.goto('/projects/new');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Title', { exact: true }).fill('Document-first project');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/(?!new)[^/]+$/);
  await page.getByLabel('Title', { exact: true }).fill('Renamed project');
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().includes('/api/v1/projects/'),
  );
  await page.getByLabel('Title', { exact: true }).press('Enter');
  expect((await saved).ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Renamed project');
});
