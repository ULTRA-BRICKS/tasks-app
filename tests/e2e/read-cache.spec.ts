import { test, expect, type Route } from '@playwright/test';
import {
  CASEY,
  JAMIE,
  SAM,
  TAYLOR,
  draftKeys,
  firstTasks,
  holdApi,
  savedCopy,
  sessionElsewhere,
  sessions,
  signIn,
} from './read-cache-fixture';
// Real IndexedDB in Chromium and WebKit with the Service Worker blocked; the network is held or
// mocked per scenario. The real worker is exercised separately by read-cache.shell.spec.ts.
test.use({ serviceWorkers: 'block' });

test('a warm start renders the saved list and task read-only until the session is confirmed', async ({
  page,
}) => {
  await signIn(page, JAMIE);
  const [task] = await firstTasks(page, 1);
  await page.goto('/tasks/' + task.id);
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await expect(title).toHaveValue(task.title);
  await expect
    .poll(async () => (await savedCopy(page)).keys)
    .toContain(JSON.stringify(['issue', task.id]));
  const api = await holdApi(page);
  let writes = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/') && request.method() !== 'GET') writes++;
  });
  await page.reload();
  const notice = page.getByRole('status', { name: 'Saved copy' });
  await expect(notice).toContainText('Saved copy from');
  await expect(notice).toContainText('Read-only. Checking your session');
  await expect(title).toHaveValue(task.title);
  // A property change is refused before the network and explained; nothing is sent.
  await page.getByRole('combobox', { name: 'Estimate', exact: true }).click();
  await page.getByRole('option', { name: '5 points', exact: true }).click();
  await expect(page.getByText('Tasks is showing a saved copy until your session')).toBeVisible();
  expect(writes).toBe(0);
  // The saved list opens in the app too while the network is still held.
  await page.getByRole('link', { name: 'All tasks', exact: true }).click();
  await expect(page.getByRole('button', { name: task.key + ' ' + task.title })).toBeVisible();
  await expect(notice).toContainText('Read-only. Checking your session');
  await api.release();
  await expect(notice).toBeHidden();
});

test('rate limiting, server errors and a lost connection stay explicit until a retry succeeds', async ({
  page,
}) => {
  await signIn(page, JAMIE);
  await expect.poll(async () => (await savedCopy(page)).keys).toContain('["catalog"]');
  const reply = (status: number, code: string) => (route: Route) =>
    route.fulfill({
      status,
      headers: status === 429 ? { 'retry-after': '120' } : {},
      json: { error: { code, message: 'Synthetic ' + code } },
    });
  await page.route('**/api/v1/me', reply(429, 'RATE_LIMITED'));
  await page.reload();
  const notice = page.getByRole('status', { name: 'Saved copy' }),
    retry = page.getByRole('button', { name: 'Retry now', exact: true });
  await expect(notice).toContainText('The server asked Tasks to wait. Retrying at');
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
  await page.route('**/api/v1/me', reply(503, 'UNAVAILABLE'));
  await retry.click();
  await expect(notice).toContainText('The server is unavailable. Retrying at');
  await page.route('**/api/v1/me', (route) => route.abort('internetdisconnected'));
  await retry.click();
  await expect(notice).toContainText('No connection to Tasks');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await retry.click();
  await expect(notice).toBeHidden();
});

test('once the session is confirmed, a failed refresh shows its error instead of the old list', async ({
  page,
}) => {
  await signIn(page, JAMIE);
  await expect(page.getByRole('status', { name: 'Saved copy' })).toHaveCount(0);
  await page.route(
    (url) => url.pathname === '/api/v1/issues',
    (route) =>
      route.fulfill({
        status: 403,
        json: { error: { code: 'FORBIDDEN', message: 'Synthetic lost access' } },
      }),
  );
  await page.getByRole('button', { name: 'Refresh tasks', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Synthetic lost access' })).toBeVisible();
  await expect(page.getByTestId('issue-row')).toHaveCount(0);
});

test('a project missing from the saved copy is not reported as deleted while offline', async ({
  page,
}) => {
  await signIn(page, JAMIE);
  await page.goto('/projects');
  await expect.poll(async () => (await savedCopy(page)).keys).toContain('["projects"]');
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => route.abort('internetdisconnected'),
  );
  await page.goto('/projects/00000000-0000-4000-8000-00000000abcd');
  await expect(page.getByRole('status', { name: 'Saved copy' })).toContainText(
    'No connection to Tasks',
  );
  await expect(page.getByRole('alert')).toContainText('not in the saved copy');
});

test('Load more pages and filtered lists come back from the saved copy with their cursor', async ({
  page,
}) => {
  await signIn(page, JAMIE);
  const [sample] = await firstTasks(page, 1);
  const extra = 'Synthetic second page task';
  // A synthetic second page behind every real last page exercises Load more on a small seed.
  await page.route(
    (url) => url.pathname === '/api/v1/issues',
    async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor');
      if (cursor === 'synthetic-page-2')
        return route.fulfill({
          json: {
            data: [{ ...sample, id: '00000000-0000-4000-8000-000000009002', title: extra }],
            next_cursor: null,
          },
        });
      const response = await route.fetch();
      const body = await response.json();
      return route.fulfill({
        response,
        json: { ...body, next_cursor: body.next_cursor ?? 'synthetic-page-2' },
      });
    },
  );
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Load more tasks', exact: true }).click();
  await expect(page.getByText(extra)).toBeVisible();
  // Writes are coalesced for 400 ms; a full page load before then would drop the second page.
  await expect.poll(async () => (await savedCopy(page, [extra])).found[0]).toBe(true);
  const word = sample.title.split(/\W+/).sort((a, b) => b.length - a.length)[0];
  await page.goto('/tasks?q=' + encodeURIComponent(word));
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
  await expect
    .poll(async () => {
      const saved = await savedCopy(page, [extra]);
      return saved.found[0] && saved.keys.includes(JSON.stringify(['issues', { q: word }]));
    })
    .toBe(true);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const api = await holdApi(page);
  await page.reload();
  await expect(page.getByRole('status', { name: 'Saved copy' })).toBeVisible();
  const rows = page.getByTestId('issue-row');
  await expect(rows.first()).toBeVisible();
  for (const name of await rows.locator('.issue-open').allInnerTexts())
    expect(name.toLowerCase()).toContain(word.toLowerCase());
  await page.goto('/tasks');
  await expect(page.getByText(extra)).toBeVisible();
  // The restored second page ended the list, so no stale cursor is offered.
  await expect(page.getByRole('button', { name: 'Load more tasks', exact: true })).toHaveCount(0);
  await api.release();
});

test('newer unsent drafts win over the saved copy and a rejected edit never reaches it', async ({
  page,
}) => {
  await signIn(page, JAMIE);
  const [, task] = await firstTasks(page, 2);
  const row = page
    .getByTestId('issue-row')
    .filter({ has: page.getByRole('button', { name: task.key + ' ' + task.title }) });
  const assignee = row.getByRole('combobox', { name: /Assignee/ });
  const before = await assignee.getAttribute('aria-label');
  await page.route('**/api/v1/issues/' + task.id, (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({
          status: 409,
          json: { error: { code: 'VERSION_CONFLICT', message: 'Synthetic rejected assignment' } },
        })
      : route.continue(),
  );
  const target = before?.endsWith(': Unassigned') ? 'Sam Rivera' : 'Unassigned';
  await assignee.click();
  await page.getByRole('option', { name: target, exact: true }).click();
  await expect(row.getByRole('alert')).toContainText('Synthetic rejected assignment');
  await expect(assignee).toHaveAttribute('aria-label', before!);
  await page.goto('/tasks/' + task.id);
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await expect(title).toHaveValue(task.title);
  await expect
    .poll(async () => (await savedCopy(page)).keys)
    .toContain(JSON.stringify(['issue', task.id]));
  // The title edit stays an unsent draft: its save is held and never reaches the server.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.route('**/api/v1/issues/' + task.id, (route) =>
    route.request().method() === 'PATCH' ? undefined : route.continue(),
  );
  await title.fill('Unsent newer title');
  await title.press('Enter');
  const api = await holdApi(page);
  await page.reload();
  await expect(page.getByRole('status', { name: 'Saved copy' })).toBeVisible();
  await expect(title).toHaveValue('Unsent newer title');
  // The saved list still has the confirmed assignee: the rolled-back change never reached it.
  await page.getByRole('link', { name: 'All tasks', exact: true }).click();
  await expect(assignee).toHaveAttribute('aria-label', before!);
  await api.release();
});

test('sign-out keeps unsent drafts for the same account and deletes the saved copy', async ({
  page,
}) => {
  await signIn(page, TAYLOR);
  await page.goto('/projects/new');
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await title.fill('Private project draft');
  await expect.poll(async () => (await savedCopy(page)).entries).toBeGreaterThan(0);
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign out' });
  await expect(dialog).toContainText('You have 1 unsent draft on this device.');
  await dialog.getByRole('button', { name: 'Keep drafts and sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await savedCopy(page)).entries).toBe(0);
  expect(await draftKeys(page, 'plan-draft:')).toBe(1);
  sessions.delete(TAYLOR);
  await signIn(page, TAYLOR);
  await page.goto('/projects/new');
  await expect(title).toHaveValue('Private project draft');
});

test('discarding at sign-out removes only this account’s drafts', async ({ page }) => {
  await signIn(page, TAYLOR);
  await page.goto('/projects/new');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Discard me');
  await page.evaluate(() =>
    sessionStorage.setItem('plan-draft:other-workspace:other-user:projects:new', '{}'),
  );
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign out' });
  await dialog.getByRole('button', { name: 'Discard drafts and sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) => k.startsWith('plan-draft:')),
    ),
  ).toEqual(['plan-draft:other-workspace:other-user:projects:new']);
  sessions.delete(TAYLOR);
});

test('sign-out in one tab deletes the saved copy and signs out every open tab', async ({
  page,
}) => {
  await signIn(page, CASEY);
  const other = await page.context().newPage();
  await other.goto('/tasks');
  await expect(other.getByTestId('issue-row').first()).toBeVisible();
  await expect.poll(async () => (await savedCopy(page)).entries).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(other.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await expect(other.getByTestId('issue-row')).toHaveCount(0);
  expect((await savedCopy(other)).entries).toBe(0);
  sessions.delete(CASEY);
});

test('a revoked session deletes the saved copy on the next start but keeps drafts', async ({
  page,
}) => {
  await signIn(page, CASEY);
  await page.goto('/projects/new');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Draft survives revocation');
  await expect.poll(async () => (await savedCopy(page)).entries).toBeGreaterThan(0);
  // Another client ends this session; the browser learns it only from the next 401.
  expect(
    (await page.request.post('/api/auth/logout', { headers: { 'x-tickets-csrf': '1' } })).ok(),
  ).toBe(true);
  page.on('dialog', (dialog) => void dialog.accept());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await expect.poll(async () => (await savedCopy(page)).entries).toBe(0);
  expect(await draftKeys(page, 'plan-draft:')).toBe(1);
  sessions.delete(CASEY);
});

test('when the browser session now belongs to another account the previous copy is discarded', async ({
  page,
  browser,
}) => {
  await signIn(page, SAM);
  const sam = await (await page.request.get('/api/v1/me')).json();
  await expect.poll(async () => (await savedCopy(page, [sam.id])).owners[0]).toBe(true);
  // Another window signs in as Jamie: the shared cookie changes without this tab signing out.
  const jamie = sessions.get(JAMIE) ?? (await sessionElsewhere(browser, JAMIE));
  await page.context().clearCookies();
  await page.context().addCookies(jamie);
  await page.reload();
  await expect(page.locator('.profile-row')).toContainText('Jamie Chen');
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
  // Sam's entries go at once; Jamie's confirmed replies are written after the 400 ms coalescing.
  await expect
    .poll(async () => {
      const saved = await savedCopy(page, [sam.id]);
      return { sam: saved.owners[0], accounts: saved.accounts };
    })
    .toEqual({ sam: false, accounts: 1 });
});
