import { test, expect } from '@playwright/test';
import { login } from './session-fixture';
test('UUID, code, optional slug and legacy paths open the same task without changing identity', async ({
  page,
}) => {
  await login(page);
  const listed = await (await page.request.get('/api/v1/issues')).json();
  const task = listed.data[0];
  let mutations = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method())) mutations++;
  });
  const routes = [
    `/tasks/${task.id}`,
    `/tasks/${task.key}`,
    `/tasks/${task.key}/a-title-that-is-now-stale`,
    `/tasks/${task.key}-a-title-that-is-now-stale`,
    `/issues/${task.id}`,
    `/issues/${task.key}/старое-название`,
  ];
  for (const path of routes) {
    await page.goto(path + '?status=retained#activity');
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(task.title);
    expect(page.url()).toContain('/tasks/');
    expect(new URL(page.url()).search).toBe('?status=retained');
    expect(new URL(page.url()).hash).toBe('#activity');
    await expect(page.getByText(task.key, { exact: true }).first()).toBeVisible();
  }
  expect(mutations).toBe(0);
});
test('new and list routes use Tasks naming while the issue API stays compatible', async ({
  page,
}) => {
  await login(page);
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: 'All tasks', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/new$/);
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('');
  expect((await page.request.get('/api/v1/issues')).status()).toBe(200);
});
test('a missing task code and native task history use task wording', async ({ page }) => {
  await login(page);
  const task = (await (await page.request.get('/api/v1/issues')).json()).data[0];
  await page.goto('/tasks/' + task.id);
  const activity = page.locator('.activity-section');
  await expect(activity).toContainText('created the task');
  await expect(activity).not.toContainText(/\bissues?\b/i);
  const missing = task.key.replace(/\d+$/, '99999');
  const response = await page.request.get('/api/v1/issues/' + missing);
  expect(response.status()).toBe(404);
  expect((await response.json()).error.code).toBe('NOT_FOUND');
  await page.goto('/tasks/' + missing);
  await expect(page.getByText('Task not found', { exact: true })).toBeVisible();
  await expect(page.getByText(/issue not found/i)).toHaveCount(0);
});

test('task details keep the document-specific mobile chrome', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await login(page);
    await page.locator('.issue-open').first().click();
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toBeVisible();
    await expect(page.locator('.mobile-create')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
test('old issue terminology still finds the renamed action in the command menu', async ({
  page,
}) => {
  await login(page);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  const menu = page.getByRole('dialog', { name: 'Command menu', exact: true });
  await menu.getByRole('combobox').fill('issue');
  await expect(menu.getByRole('option').filter({ hasText: 'Create new task' })).toHaveCount(1);
});

test('saving and commenting from a code-slug URL refresh the same immutable task', async ({
  page,
  browserName,
}) => {
  await login(page);
  const task = (await (await page.request.get('/api/v1/issues')).json()).data[0];
  await page.goto('/tasks/' + task.key + '/stale-title');
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await expect(title).toHaveValue(task.title);
  const updated = task.title + ' through code ' + browserName;
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().endsWith('/api/v1/issues/' + task.id),
  );
  await title.fill(updated);
  await title.press('Enter');
  expect((await saved).status()).toBe(200);
  await page.waitForLoadState('networkidle');
  const comment = 'Visible alias comment ' + browserName;
  await page.getByRole('textbox', { name: 'Comment', exact: true }).fill(comment);
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(page.locator('article.comment').filter({ hasText: comment })).toHaveCount(1);
  const fresh = await (await page.request.get('/api/v1/issues/' + task.id)).json();
  expect(fresh.key).toBe(task.key);
  expect(fresh.title).toBe(updated);
});
