import { test, expect, type Page, type Route } from '@playwright/test';
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
/**
 * Records browser dialogs ("Leave site?" is `beforeunload`), accepting them so a test fails on
 * the assertion instead of hanging on the prompt.
 */
function leavePrompts(page: Page) {
  const prompts: string[] = [];
  page.on('dialog', (dialog) => {
    prompts.push(dialog.type());
    void dialog.accept();
  });
  return prompts;
}

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
  const prompts = leavePrompts(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign out' });
  await expect(dialog).toContainText('You have 1 unsent draft on this device.');
  await dialog.getByRole('button', { name: 'Keep drafts and sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  // The dialog already settled the drafts, so the browser does not ask "Leave site?" again.
  expect(prompts).toEqual([]);
  expect((await savedCopy(page)).entries).toBe(0);
  expect(await draftKeys(page, 'plan-draft:')).toBe(1);
  sessions.delete(TAYLOR);
  await signIn(page, TAYLOR);
  await page.goto('/projects/new');
  await expect(title).toHaveValue('Private project draft');
});

test('discarding at sign-out removes only this account’s drafts', async ({ page }) => {
  await signIn(page, TAYLOR);
  // The new-task editor asks "Leave site?" from its in-memory text, which discarding keeps.
  await page.goto('/tasks/new');
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await title.fill('Discard me');
  await expect.poll(() => draftKeys(page, 'ticket-new:')).toBe(1);
  await page.evaluate(() =>
    sessionStorage.setItem('ticket-new:other-workspace:other-user:issue', '{}'),
  );
  const prompts = leavePrompts(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign out' });
  await dialog.getByRole('button', { name: 'Discard drafts and sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(prompts).toEqual([]);
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) => k.startsWith('ticket-new:')),
    ),
  ).toEqual(['ticket-new:other-workspace:other-user:issue']);
  sessions.delete(TAYLOR);
});

test('discarding drafts waits until the sign-out reaches the server', async ({ page }) => {
  await signIn(page, JAMIE);
  await page.goto('/tasks/new');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Keep me until signed out');
  await expect.poll(() => draftKeys(page, 'ticket-new:')).toBe(1);
  await page.route('**/api/auth/logout', (route) => route.abort('internetdisconnected'));
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign out' });
  await dialog.getByRole('button', { name: 'Discard drafts and sign out', exact: true }).click();
  await expect(dialog).toContainText('This browser is still signed in.');
  // Still signed in, so the drafts are still wanted: nothing is discarded until sign-out succeeds.
  expect(await draftKeys(page, 'ticket-new:')).toBe(1);
  await expect(dialog).toContainText('Nothing was discarded.');
});

test('after a failed sign-out every tab stays signed in and can edit', async ({ page }) => {
  await signIn(page, JAMIE);
  const [task] = await firstTasks(page, 1);
  await page.goto('/tasks/' + task.id);
  const estimate = page.getByRole('combobox', { name: 'Estimate', exact: true });
  await expect(estimate).toBeVisible();
  const other = await page.context().newPage();
  await other.goto('/tasks');
  await expect(other.getByTestId('issue-row').first()).toBeVisible();
  await page.route('**/api/auth/logout', (route) => route.abort('internetdisconnected'));
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign out' });
  await expect(dialog).toContainText('This browser is still signed in.');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  // The device copy was deleted, but the session was not: the tabs confirm it again and rebuild it.
  await expect.poll(async () => (await savedCopy(page)).keys).toContain('["me"]');
  await expect(other.getByTestId('issue-row').first()).toBeVisible();
  // An edit leaves this tab again (aborted here, so the shared test data stays unchanged).
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/issues/'),
    (route) => (route.request().method() === 'PATCH' ? route.abort() : route.fallback()),
  );
  const write = page.waitForRequest((request) => request.method() === 'PATCH', { timeout: 5000 });
  await estimate.click();
  await page.getByRole('option', { name: '5 points', exact: true }).click();
  await write;
});

test('on a phone the Sign out dialog covers the navigation drawer it opens from', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  leavePrompts(page);
  await signIn(page, JAMIE);
  await page.goto('/projects/new');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Phone draft');
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'More navigation', exact: true }).click();
  const inbox = page
    .getByRole('dialog', { name: 'Navigation' })
    .getByRole('link', { name: /^Inbox/ });
  const box = await inbox.boundingBox();
  if (!box) throw new Error('The navigation drawer did not lay out its Inbox link');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Sign out' })).toBeVisible();
  // Topmost first: the Sign out dialog's backdrop lies above the drawer and dims it.
  const layers = await page.evaluate(
    ([x, y]) =>
      document.elementsFromPoint(x, y).map((element) => element.getAttribute('class') ?? ''),
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  const backdrop = layers.findIndex((name) => name.includes('dialog-backdrop'));
  expect(backdrop).toBeGreaterThanOrEqual(0);
  expect(backdrop).toBeLessThan(layers.findIndex((name) => name.includes('mobile-nav-dialog')));
});

test('text saved nowhere is asked about before sign-out ends the session', async ({ page }) => {
  await signIn(page, CASEY);
  await page.goto('/tasks/new');
  // Storage refuses the draft, so nothing is counted and only the editor's in-memory text remains.
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage is full', 'QuotaExceededError');
    };
  });
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await title.fill('Saved nowhere');
  const prompts = leavePrompts(page);
  let logouts = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/auth/logout')) logouts++;
  });
  const signOut = page.getByRole('button', { name: 'Sign out', exact: true });
  await signOut.click();
  const dialog = page.getByRole('dialog', { name: 'Sign out' });
  await expect(dialog).toContainText('could not be saved on this device');
  // Nothing focused would discard the text; Cancel keeps it and the session.
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancel).toBeFocused();
  await cancel.click();
  await expect(dialog).toBeHidden();
  await expect(title).toHaveValue('Saved nowhere');
  expect(logouts).toBe(0);
  await signOut.click();
  await dialog.getByRole('button', { name: 'Discard text and sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  // The dialog already asked, so the browser does not ask "Leave site?" once the session ended.
  expect(prompts).toEqual([]);
  expect(logouts).toBe(1);
  sessions.delete(CASEY);
});

test('text saved nowhere is asked about even when other drafts are kept', async ({ page }) => {
  await signIn(page, TAYLOR);
  await page.goto('/projects/new');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Kept plan');
  await expect.poll(() => draftKeys(page, 'plan-draft:')).toBe(1);
  const prompts = leavePrompts(page);
  await page.goto('/tasks/new');
  // Storage fills up after the plan draft was kept, so this editor's text lives only in memory.
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage is full', 'QuotaExceededError');
    };
  });
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await title.fill('Saved nowhere');
  const asked = prompts.length;
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign out' });
  await expect(dialog).toContainText('You have 1 unsent draft on this device.');
  await expect(dialog).toContainText('could not be saved on this device');
  await dialog.getByRole('button', { name: 'Keep drafts and sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  // The dialog answered for the text, so the sign-out navigation does not ask "Leave site?".
  expect(prompts.length).toBe(asked);
  expect(await draftKeys(page, 'plan-draft:')).toBe(1);
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

test('signing out after the session already ended completes the sign-out', async ({ page }) => {
  await signIn(page, CASEY);
  await expect.poll(async () => (await savedCopy(page)).entries).toBeGreaterThan(0);
  // Another client ends this session before this tab makes its next request.
  expect(
    (await page.request.post('/api/auth/logout', { headers: { 'x-tickets-csrf': '1' } })).ok(),
  ).toBe(true);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await savedCopy(page)).entries).toBe(0);
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
