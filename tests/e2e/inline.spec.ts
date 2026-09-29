import { test, expect, type Page, type BrowserContext } from '@playwright/test';
let savedCookies: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;
async function login(page: Page) {
  // One real sign-in per worker; production rate limits stay unchanged.
  if (savedCookies) {
    await page.context().addCookies(savedCookies);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'All tasks', exact: true })).toBeVisible();
    return;
  }
  await page.goto('/issues');
  await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All tasks', exact: true })).toBeVisible();
  savedCookies = await page.context().cookies();
}
async function newIssue(page: Page, title: string) {
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/new$/);
  await expect(page.locator('.document-description[contenteditable=true]')).toBeVisible();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
}
test('opening a new page creates nothing and a private draft survives navigation', async ({
  page,
}) => {
  await login(page);
  const before = (await (await page.request.get('/api/v1/issues')).json()).data.length;
  await newIssue(page, 'Unpublished private draft');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Keep this text');
  await page.getByRole('button', { name: 'Back to tasks', exact: true }).click();
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
    'Unpublished private draft',
  );
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveText(
    'Keep this text',
  );
  expect((await (await page.request.get('/api/v1/issues')).json()).data.length).toBe(before);
});
test('keyboard list navigation, opening and return do not capture editor input', async ({
  page,
}) => {
  await login(page);
  await page.keyboard.press('j');
  await expect(page.locator('.issue-list .issue-open').first()).toBeFocused();
  await page.keyboard.press('j');
  await expect(page.locator('.issue-list .issue-open').nth(1)).toBeFocused();
  await page.keyboard.press('k');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/tasks\/(?!new)[^/]+$/);
  await page.getByRole('textbox', { name: 'Title', exact: true }).focus();
  const previous = await page.getByRole('textbox', { name: 'Title', exact: true }).inputValue();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(previous);
  await page.keyboard.type(' cvgjk');
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
    previous + ' cvgjk',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(previous);
  await page.locator('.issue-detail-toolbar').click({ position: { x: 190, y: 18 } });
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/tasks$/);
  await page.keyboard.press('g');
  await page.keyboard.press('p');
  await expect(page).toHaveURL(/\/projects$/);
});
test('estimate and dates chosen during inline creation persist on the server', async ({ page }) => {
  await login(page);
  await newIssue(page, 'Preserve creation properties');
  await page.getByRole('combobox', { name: 'Estimate', exact: true }).click();
  await page.getByRole('option', { name: '5 points', exact: true }).click();
  for (const [name, value] of [
    ['Start date', '2026-10-01'],
    ['Due date', '2026-10-08'],
  ]) {
    await page.getByRole('textbox', { name, exact: true }).fill(value);
    await page.getByRole('textbox', { name, exact: true }).press('Enter');
  }
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/(?!new)[^/]+$/);
  const id = new URL(page.url()).pathname.split('/').at(-1);
  const issue = await (await page.request.get('/api/v1/issues/' + id)).json();
  expect(issue).toMatchObject({ estimate: 5, start_date: '2026-10-01', due_date: '2026-10-08' });
});
test('lost create response retries the identical request instead of duplicating an issue', async ({
  page,
}, testInfo) => {
  const title = `Ambiguous create response ${testInfo.project.name} ${Date.now()}`;
  await login(page);
  await newIssue(page, title);
  const keys: string[] = [];
  await page.route('**/api/v1/issues', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length === 1) {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry creation', exact: true })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveAttribute(
    'readonly',
    '',
  );
  await page.getByRole('button', { name: 'Retry creation', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/(?!new)[^/]+$/);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[0]).toBe(keys[1]);
  const issues = await (
    await page.request.get('/api/v1/issues?q=' + encodeURIComponent(title))
  ).json();
  expect(issues.data).toHaveLength(1);
});
test('newer text survives an earlier save response and a second commit', async ({ page }) => {
  await login(page);
  await newIssue(page, 'Concurrent editor test');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/(?!new)[^/]+$/);
  let release: () => void = () => {};
  let patches = 0;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/issues/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    patches++;
    if (patches === 1) {
      const response = await route.fetch();
      await waiting;
      await route.fulfill({ response });
    } else await route.continue();
  });
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await title.fill('First committed text');
  await title.press('Enter');
  await expect.poll(() => patches).toBe(1);
  await title.fill('Later committed text');
  await title.press('Enter');
  release();
  await expect.poll(() => patches).toBe(2);
  await expect(page.getByText('Saving…', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(title).toHaveValue('Later committed text');
});
test('project and cycle creation use document pages and persist inline name edits', async ({
  page,
}) => {
  await login(page);
  for (const kind of ['projects', 'cycles']) {
    await page.goto('/' + kind + '/new');
    const title = page.getByRole('textbox', { name: 'Title', exact: true });
    await expect(title).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await title.fill('October ' + kind);
    if (kind === 'cycles') {
      for (const [name, value] of [
        ['Start date', '2026-10-01'],
        ['End date', '2026-10-14'],
      ]) {
        await page.getByRole('textbox', { name, exact: true }).fill(value);
        await page.getByRole('textbox', { name, exact: true }).press('Enter');
      }
    }
    await page
      .getByRole('button', {
        name: 'Create ' + (kind === 'projects' ? 'project' : 'cycle'),
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(new RegExp('/' + kind + '/(?!new)[^/]+$'));
    await title.fill('Updated ' + kind);
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' && r.url().includes('/api/v1/' + kind + '/') && r.ok(),
    );
    await title.press('Enter');
    await saved;
    await page.reload();
    await expect(title).toHaveValue('Updated ' + kind);
  }
});

test('focused clean description keeps its original version through a remote refetch', async ({
  page,
}) => {
  await login(page);
  await newIssue(page, 'Focused refetch safety');
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Original content');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/(?!new)[^/]+$/);
  const id = new URL(page.url()).pathname.split('/').at(-1);
  const editor = page.getByRole('textbox', { name: 'Description', exact: true });
  await expect(page.locator('.document-description[contenteditable=true]')).toBeVisible();
  await editor.focus();
  const issue = await (await page.request.get('/api/v1/issues/' + id)).json();
  const remote = await page.request.patch('/api/v1/issues/' + id, {
    headers: { 'x-tickets-csrf': '1' },
    data: { version: issue.version, description: 'New text from another user' },
  });
  expect(remote.ok()).toBeTruthy();
  await page.clock.install();
  await page.clock.fastForward(20000);
  const refresh = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/issues/' + id) && r.request().method() === 'GET',
  );
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await refresh;
  await editor.fill('My local edit from the previous version');
  await page.getByRole('textbox', { name: 'Title', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Keep my task draft', exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/v1/issues/' + id)).json()).description).toBe(
    'New text from another user',
  );
  await expect(editor).toHaveText('My local edit from the previous version');
  page.once('dialog', (d) => d.accept());
  const resolved = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().endsWith('/api/v1/issues/' + id) && r.ok(),
  );
  await page.getByRole('button', { name: 'Keep my task draft', exact: true }).click();
  await resolved;
  expect((await (await page.request.get('/api/v1/issues/' + id)).json()).description).toBe(
    'My local edit from the previous version',
  );
});
test('opening extended Markdown and editing only the title never rewrites the body', async ({
  page,
}) => {
  await login(page);
  const catalog = await (await page.request.get('/api/v1/catalog')).json();
  const description = 'Before\n\n[guide]: https://example.com\n\nAfter';
  const created = await page.request.post('/api/v1/issues', {
    headers: { 'x-tickets-csrf': '1' },
    data: { title: 'Keep reference definitions', description, team_id: catalog.teams[0].id },
  });
  expect(created.status()).toBe(201);
  const issue = await created.json();
  await page.goto('/issues/' + issue.id);
  const body = page.getByRole('textbox', { name: 'Description', exact: true });
  await expect(body).toHaveAttribute('contenteditable', 'true');
  await expect(body.getByText('[guide]: https://example.com', { exact: true })).toBeVisible();
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await title.fill('Only a title change');
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === 'PATCH' && r.url().includes('/api/v1/issues/' + issue.id) && r.ok(),
  );
  await title.press('Enter');
  await saved;
  expect((await (await page.request.get('/api/v1/issues/' + issue.id)).json()).description).toBe(
    description,
  );
});
// Same Markdown syntax as the production UB-35 body that opened as source (UB-75).
const STRUCTURED = [
  'Source: feedback-20260925-14',
  '',
  '## What',
  '',
  'Rename user-facing wording to Task/Tasks.',
  '',
  '## Acceptance criteria',
  '',
  '- [ ] Visible headings use Task/Tasks.',
  '- [ ] Legacy search words remain aliases where useful.',
  '',
  '## Evidence and scope',
  '',
  'Related example: [https://tasks.example.test/issues/a76c](<https://tasks.example.test/issues/a76c>) .',
].join('\n');
async function openStructured(page: Page, title: string) {
  await login(page);
  const catalog = await (await page.request.get('/api/v1/catalog')).json();
  const created = await page.request.post('/api/v1/issues', {
    headers: { 'x-tickets-csrf': '1' },
    data: { title, description: STRUCTURED, team_id: catalog.teams[0].id },
  });
  expect(created.status()).toBe(201);
  const issue = await created.json();
  await page.goto('/issues/' + issue.id);
  const body = page.getByRole('textbox', { name: 'Description', exact: true });
  await expect(body).toHaveAttribute('contenteditable', 'true');
  return { id: issue.id as string, body };
}
test('structured descriptions open in the rich editor and a checkbox toggle persists', async ({
  page,
}) => {
  const { id, body } = await openStructured(page, 'Structured description');
  await expect(
    body.getByRole('heading', { name: 'Acceptance criteria', exact: true }),
  ).toBeVisible();
  await expect(page.locator('textarea[aria-label="Description"]')).toHaveCount(0);
  await expect(page.getByText('This description contains extended Markdown')).toHaveCount(0);
  const name = 'Legacy search words remain aliases where useful.';
  await expect(body.getByRole('checkbox', { name, exact: true })).not.toBeChecked();
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().includes('/api/v1/issues/' + id) && r.ok(),
  );
  await body.getByRole('checkbox', { name, exact: true }).click();
  await saved;
  expect((await (await page.request.get('/api/v1/issues/' + id)).json()).description).toBe(
    STRUCTURED.replace('- [ ] Legacy', '- [x] Legacy'),
  );
  await page.reload();
  await expect(
    page
      .getByRole('textbox', { name: 'Description', exact: true })
      .getByRole('checkbox', { name, exact: true }),
  ).toBeChecked();
});
test('editing a heading in a structured description saves only that heading', async ({ page }) => {
  const { id, body } = await openStructured(page, 'Structured heading edit');
  const heading = body.getByRole('heading', { name: 'What', exact: true });
  const box = await heading.boundingBox();
  if (!box) throw new Error('heading is not rendered');
  // Clicking the empty end of the heading line places the caret after its text in both engines.
  await heading.click({ position: { x: box.width - 4, y: box.height / 2 } });
  await page.keyboard.type(' changed');
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().includes('/api/v1/issues/' + id) && r.ok(),
  );
  await page.getByRole('textbox', { name: 'Title', exact: true }).click();
  await saved;
  expect((await (await page.request.get('/api/v1/issues/' + id)).json()).description).toBe(
    STRUCTURED.replace('## What\n', '## What changed\n'),
  );
});
test('planning conflict can be resolved explicitly without trapping a persisted draft', async ({
  page,
}) => {
  await login(page);
  await page.goto('/projects/new');
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await title.fill('Planning conflict');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/(?!new)[^/]+$/);
  const id = new URL(page.url()).pathname.split('/').at(-1);
  const list = await (await page.request.get('/api/v1/projects')).json();
  const existing = list.find((p: { id: string }) => p.id === id);
  const r = await page.request.patch('/api/v1/projects/' + id, {
    headers: { 'x-tickets-csrf': '1' },
    data: { version: existing.version, name: 'Remote project name' },
  });
  expect(r.ok()).toBeTruthy();
  await title.fill('My conflicting local name');
  await title.press('Enter');
  await expect(page.getByRole('region', { name: 'Resolve conflict' })).toBeVisible();
  await expect(title).toHaveValue('My conflicting local name');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Use server version', exact: true }).click();
  await expect(title).toHaveValue('Remote project name');
  await title.fill('Now reconciled');
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().includes('/api/v1/projects/' + id) && r.ok(),
  );
  await title.press('Enter');
  await saved;
  await page.reload();
  await expect(title).toHaveValue('Now reconciled');
});
test('logout clears planning drafts as well as issue drafts', async ({ page }) => {
  await login(page);
  await page.goto('/projects/new');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Private project draft');
  expect(
    await page.evaluate(() => Object.keys(sessionStorage).some((k) => k.startsWith('plan-draft:'))),
  ).toBe(true);
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /sign out|log out/i }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).some((k) => /^(plan-draft:|ticket-new:|ticket-draft:)/.test(k)),
    ),
  ).toBe(false);
  savedCookies = undefined;
});

test('command menu works inside text editors without treating ordinary letters as commands', async ({
  page,
}) => {
  await login(page);
  await newIssue(page, 'Editor command menu');
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await title.focus();
  await page.keyboard.press('Control+k');
  await expect(
    page.getByRole('combobox', { name: 'Search commands and tasks', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(title).toHaveValue('Editor command menu');
});
test('Escape restores extended Markdown without committing the canceled source', async ({
  page,
}) => {
  await login(page);
  const catalog = await (await page.request.get('/api/v1/catalog')).json();
  const description = 'Before\n\n[guide]: https://example.com\n\nAfter';
  const created = await page.request.post('/api/v1/issues', {
    headers: { 'x-tickets-csrf': '1' },
    data: { title: 'Cancel extended Markdown', description, team_id: catalog.teams[0].id },
  });
  const issue = await created.json();
  await page.goto('/issues/' + issue.id);
  const body = page.getByRole('textbox', { name: 'Description', exact: true });
  const definition = body.getByText('[guide]: https://example.com', { exact: true });
  await expect(definition).toBeVisible();
  await body.fill('Canceled edit');
  await expect(definition).toHaveCount(0);
  await body.press('Escape');
  await expect(definition).toBeVisible();
  await expect(body.getByText('After', { exact: true })).toBeVisible();
  await expect(body).not.toContainText('Canceled edit');
  await page.getByRole('textbox', { name: 'Title', exact: true }).click();
  expect((await (await page.request.get('/api/v1/issues/' + issue.id)).json()).description).toBe(
    description,
  );
});
test('a clean project follows a refetch before the next inline edit', async ({ page }) => {
  await login(page);
  await page.goto('/projects/new');
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await expect(title).toHaveAttribute('maxlength', '200');
  await title.fill('Clean project synchronization');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/(?!new)[^/]+$/);
  const id = new URL(page.url()).pathname.split('/').at(-1);
  const item = (await (await page.request.get('/api/v1/projects')).json()).find(
    (p: { id: string }) => p.id === id,
  );
  const r = await page.request.patch('/api/v1/projects/' + id, {
    headers: { 'x-tickets-csrf': '1' },
    data: { version: item.version, name: 'Newer server project' },
  });
  expect(r.ok()).toBeTruthy();
  await page.clock.install();
  await page.clock.fastForward(20000);
  const refresh = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/projects') && r.request().method() === 'GET',
  );
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await refresh;
  await expect(title).toHaveValue('Newer server project');
  await title.fill('Next edit uses the refreshed version');
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/projects/' + id) && r.request().method() === 'PATCH',
  );
  await title.press('Enter');
  expect((await saved).status()).toBe(200);
});

test('a posted comment response does not erase the next comment being typed', async ({ page }) => {
  await login(page);
  await newIssue(page, 'Concurrent comments');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/(?!new)[^/]+$/);
  let release: () => void = () => {},
    reached = false;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/issues/*/comments', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    reached = true;
    await waiting;
    await route.fulfill({ response });
  });
  const comment = page.getByRole('textbox', { name: 'Comment', exact: true });
  await comment.fill('First comment');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect.poll(() => reached).toBe(true);
  await comment.fill('The next comment, not yet sent');
  release();
  await expect(page.getByRole('button', { name: 'Comment', exact: true })).toBeEnabled();
  await expect(comment).toHaveValue('The next comment, not yet sent');
});

test('issue text conflict can be resolved explicitly without endless stale retries', async ({
  page,
}) => {
  await login(page);
  await newIssue(page, 'Conflict fixture');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/(?!new)[^/]+$/);
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await expect(title).toHaveValue('Conflict fixture');
  // Start the local edit before the remote write, so this deterministically tests a conflict.
  await title.fill('Local draft retained');
  const id = new URL(page.url()).pathname.split('/').at(-1);
  const current = await (await page.request.get('/api/v1/issues/' + id)).json();
  const remote = await page.request.patch('/api/v1/issues/' + id, {
    headers: { 'x-tickets-csrf': '1' },
    data: { version: current.version, title: 'Remote writer' },
  });
  expect(remote.ok()).toBeTruthy();
  await page.getByRole('textbox', { name: 'Title', exact: true }).press('Enter');
  const conflict = page.getByRole('region', { name: 'Resolve task conflict' });
  await expect(conflict).toBeVisible();
  // Activity also lists the remote rename (Title → Remote writer); the conflict panel must show it.
  await expect(conflict.getByText('Remote writer', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
    'Local draft retained',
  );
  page.once('dialog', (dialog) => void dialog.accept());
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === 'PATCH' &&
      r.url().endsWith('/api/v1/issues/' + id) &&
      r.status() === 200,
  );
  await page.getByRole('button', { name: 'Keep my task draft', exact: true }).click();
  await saved;
  await expect(page.getByRole('region', { name: 'Resolve task conflict' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
    'Local draft retained',
  );
});
test('extended Markdown Escape cancels and command menu works from the rich editor', async ({
  page,
}) => {
  await login(page);
  const catalog = await (await page.request.get('/api/v1/catalog')).json();
  const description = '[reference]: https://example.org/\n\nA [reference] remains literal.';
  const created = await page.request.post('/api/v1/issues', {
    headers: { 'x-tickets-csrf': '1' },
    data: { title: 'Extended Markdown', description, team_id: catalog.teams[0].id },
  });
  expect(created.status()).toBe(201);
  const issue = await created.json();
  await page.goto('/issues/' + issue.id);
  const editor = page.getByRole('textbox', { name: 'Description', exact: true });
  const definition = editor.getByText('[reference]: https://example.org/', { exact: true });
  await expect(definition).toBeVisible();
  await editor.fill('Unsaved text');
  await editor.press('Escape');
  await expect(definition).toBeVisible();
  await expect(editor).not.toContainText('Unsaved text');
  await editor.focus();
  await editor.press('Control+k');
  await expect(
    page.getByRole('combobox', { name: 'Search commands and tasks', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(definition).toBeVisible();
  await expect(editor).not.toContainText('Unsaved text');
  expect((await (await page.request.get('/api/v1/issues/' + issue.id)).json()).description).toBe(
    description,
  );
});

test('planning acknowledgements adopt normalized titles without reload', async ({ page }) => {
  await login(page);
  await page.goto('/projects/new');
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await title.fill('Normalization fixture');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/(?!new)[^/]+$/);
  await title.fill('  Trim this saved title  ');
  await title.press('Enter');
  await expect(title).toHaveValue('Trim this saved title');
});

test('a posted response never erases a newly typed identical comment', async ({ page }) => {
  await login(page);
  await newIssue(page, 'Concurrent comments');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/(?!new)[^/]+$/);
  let release: () => void = () => {},
    reached = false;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/issues/*/comments', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    reached = true;
    await waiting;
    await route.fulfill({ response });
  });
  const comment = page.getByRole('textbox', { name: 'Comment', exact: true });
  await comment.fill('First comment');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect.poll(() => reached).toBe(true);
  await comment.fill('');
  await comment.fill('First comment');
  release();
  await expect(page.getByRole('button', { name: 'Comment', exact: true })).toBeEnabled();
  await expect(comment).toHaveValue('First comment');
});

test('older project acknowledgement cannot overwrite a refetched newer server version', async ({
  page,
}) => {
  await login(page);
  await page.goto('/projects/new');
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await title.fill('Planning acknowledgement race');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/(?!new)[^/]+$/);
  const id = new URL(page.url()).pathname.split('/').at(-1);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let committed!: (value: { version: number }) => void;
  const acknowledged = new Promise<{ version: number }>((resolve) => {
    committed = resolve;
  });
  await page.route('**/api/v1/projects/' + id, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    const response = await route.fetch();
    committed(await response.json());
    await held;
    await route.fulfill({ response });
  });
  await title.fill('Local version two');
  await title.press('Enter');
  const versionTwo = await acknowledged;
  const remote = await page.request.patch('/api/v1/projects/' + id, {
    headers: { 'x-tickets-csrf': '1' },
    data: {
      version: versionTwo.version,
      name: 'Remote version three',
      description: 'Remote body must survive',
    },
  });
  expect(remote.ok()).toBeTruthy();
  await page.clock.install();
  await page.clock.fastForward(20000);
  const refreshed = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/projects') && r.request().method() === 'GET',
  );
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await refreshed;
  release();
  await expect(title).toHaveValue('Remote version three');
  await page.unroute('**/api/v1/projects/' + id);
  await title.fill('Next intentional title');
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/projects/' + id) && r.request().method() === 'PATCH',
  );
  await title.press('Enter');
  expect((await saved).status()).toBe(200);
  const final = (await (await page.request.get('/api/v1/projects')).json()).find(
    (p: { id: string }) => p.id === id,
  );
  expect(final.description).toBe('Remote body must survive');
});
