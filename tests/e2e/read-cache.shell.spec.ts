import { test as base, expect, type Page } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';
import { resolveDevelopment } from '../../packages/config/development.mjs';
import { CASEY, JAMIE, SAM, firstTasks, savedCopy, sessions, signIn } from './read-cache-fixture';
// The built application with its real Service Worker and real IndexedDB, in Chromium and WebKit,
// run by `bun run test:e2e:shell` (playwright.shell.config.ts). Each worker serves the build with
// `vite preview` itself and closes it to take the network away: Playwright's offline emulation
// rejects Service Worker navigations in WebKit (microsoft/playwright#42775).
const dev = resolveDevelopment(process.env);
interface Network {
  /** Closes the web origin: every request that the worker does not answer now fails. */
  cut(): Promise<void>;
  restore(): Promise<void>;
}
const test = base.extend<object, { network: Network }>({
  network: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern.
    async ({}, use) => {
      const start = () =>
        preview({
          logLevel: 'warn',
          preview: { host: '127.0.0.1', port: dev.webPort, strictPort: true },
        });
      let server: PreviewServer | null = await start();
      await use({
        async cut() {
          await server?.close();
          server = null;
        },
        async restore() {
          server ??= await start();
        },
      });
      await server?.close();
    },
    { scope: 'worker', auto: true },
  ],
});
async function controlledByWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}
/** A document that loads while the origin is closed can only have come from the worker. */
async function offlineDocument(page: Page, load: () => Promise<unknown>) {
  await load();
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

test('an offline reload renders the saved list and task read-only from the worker and IndexedDB', async ({
  page,
  network,
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
  const notice = page.getByRole('status', { name: 'Saved copy' });
  await network.cut();
  try {
    await offlineDocument(page, () => page.reload());
    await expect(notice).toContainText('Saved copy from');
    await expect(notice).toContainText('Read-only. No connection to Tasks.');
    await expect(title).toHaveValue(task.title);
    // A property change is refused before the network and explained.
    await page.getByRole('combobox', { name: 'Estimate', exact: true }).click();
    await page.getByRole('option', { name: '5 points', exact: true }).click();
    await expect(page.getByText('Tasks is showing a saved copy until your session')).toBeVisible();
    // The saved list opens in the app too while the origin is closed.
    await page.getByRole('link', { name: 'All tasks', exact: true }).click();
    await expect(page.getByRole('button', { name: task.key + ' ' + task.title })).toBeVisible();
    // Private replies never enter the worker's public CacheStorage.
    expect(
      await page.evaluate(async () => {
        for (const name of await caches.keys())
          for (const request of await (await caches.open(name)).keys())
            if (new URL(request.url).pathname.startsWith('/api/')) return true;
        return false;
      }),
    ).toBe(false);
  } finally {
    await network.restore();
  }
  await page.getByRole('button', { name: 'Retry now', exact: true }).click();
  await expect(notice).toBeHidden();
});

test('after sign-out an offline start shows no saved workspace data', async ({ page, network }) => {
  await signIn(page, CASEY);
  await controlledByWorker(page);
  await expect.poll(async () => (await savedCopy(page)).entries).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  sessions.delete(CASEY);
  await network.cut();
  try {
    await offlineDocument(page, () => page.goto('/tasks'));
    await expect(page.getByText('Cannot reach /api/v1/me')).toBeVisible();
    await expect(page.getByTestId('issue-row')).toHaveCount(0);
    await expect(page.getByRole('status', { name: 'Saved copy' })).toHaveCount(0);
    expect((await savedCopy(page)).entries).toBe(0);
  } finally {
    await network.restore();
  }
});

test('the next account on this device never sees the previous account’s saved copy', async ({
  page,
  network,
}) => {
  await signIn(page, SAM);
  await controlledByWorker(page);
  const sam = await (await page.request.get('/api/v1/me')).json();
  await expect.poll(async () => (await savedCopy(page, [sam.id])).owners[0]).toBe(true);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  sessions.delete(SAM);
  await signIn(page, JAMIE);
  const jamie = await (await page.request.get('/api/v1/me')).json();
  await expect.poll(async () => (await savedCopy(page, [jamie.id])).owners[0]).toBe(true);
  await network.cut();
  try {
    await offlineDocument(page, () => page.reload());
    await expect(page.getByRole('status', { name: 'Saved copy' })).toContainText(
      'No connection to Tasks',
    );
    await expect(page.locator('.profile-row')).toContainText('Jamie Chen');
    await expect(page.locator('.profile-row')).not.toContainText('Sam Rivera');
    const saved = await savedCopy(page, [sam.id]);
    expect(saved.owners[0]).toBe(false);
    expect(saved.accounts).toBe(1);
  } finally {
    await network.restore();
  }
});
