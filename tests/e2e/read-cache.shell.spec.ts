import { test, expect, type Page } from '@playwright/test';
import { CASEY, JAMIE, firstTasks, savedCopy, signIn } from './read-cache-fixture';
// The built application with its real Service Worker and real IndexedDB, run by
// `bun run test:e2e:shell` (playwright.shell.config.ts). Chromium only: Playwright WebKit rejects
// offline Service Worker navigations (microsoft/playwright#42775).
async function controlledByWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}

test('an offline reload renders the saved list and task from the worker and IndexedDB', async ({
  page,
  context,
}) => {
  await signIn(page, JAMIE);
  await controlledByWorker(page);
  const [task] = await firstTasks(page, 1);
  await page.goto('/tasks/' + task.id);
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await expect(title).toHaveValue(task.title);
  await expect
    .poll(async () => (await savedCopy(page)).keys)
    .toContain(JSON.stringify(['issue', task.id]));
  let apiReplies = 0;
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.startsWith('/api/')) apiReplies++;
  });
  await context.setOffline(true);
  const response = await page.reload();
  expect(response?.fromServiceWorker()).toBe(true);
  const notice = page.getByRole('status', { name: 'Saved copy' });
  await expect(notice).toContainText('Saved copy from');
  await expect(notice).toContainText('No connection to Tasks');
  await expect(title).toHaveValue(task.title);
  await expect(page.getByRole('button', { name: task.key + ' ' + task.title })).toBeVisible();
  expect(apiReplies).toBe(0);
  // Private replies never enter the worker's public CacheStorage.
  expect(
    await page.evaluate(async () => {
      for (const name of await caches.keys())
        for (const request of await (await caches.open(name)).keys())
          if (new URL(request.url).pathname.startsWith('/api/')) return true;
      return false;
    }),
  ).toBe(false);
  await context.setOffline(false);
  await expect(notice).toBeHidden();
});

test('after sign-out an offline start shows no saved workspace data', async ({ page, context }) => {
  await signIn(page, CASEY);
  await controlledByWorker(page);
  await expect.poll(async () => (await savedCopy(page)).entries).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await context.setOffline(true);
  const response = await page.goto('/tasks');
  expect(response?.fromServiceWorker()).toBe(true);
  await expect(page.getByText('Opening workspace')).toBeVisible();
  await expect(page.getByTestId('issue-row')).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Saved copy' })).toHaveCount(0);
  expect((await savedCopy(page)).entries).toBe(0);
  await context.setOffline(false);
});
