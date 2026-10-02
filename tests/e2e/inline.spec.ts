import { test, expect, type Page, type BrowserContext } from '@playwright/test';
let savedCookies: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;
async function login(page: Page) {
  // One real sign-in per worker; production rate limits stay unchanged.
  if (savedCookies) {
    await page.context().addCookies(savedCookies);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'All issues', exact: true })).toBeVisible();
    return;
  }
  await page.goto('/issues');
  await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All issues', exact: true })).toBeVisible();
  savedCookies = await page.context().cookies();
}
async function newIssue(page: Page, title: string) {
  await page.getByRole('button', { name: 'New issue', exact: true }).click();
  await expect(page).toHaveURL(/\/issues\/new$/);
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
  await page.getByRole('button', { name: 'Back to issues', exact: true }).click();
  await page.getByRole('button', { name: 'New issue', exact: true }).click();
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
  await expect(page).toHaveURL(/\/issues\/(?!new)[^/]+$/);
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
  await expect(page).toHaveURL(/\/issues$/);
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
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByLabel(name + ' value', { exact: true }).fill(value);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Create issue', exact: true }).click();
  await expect(page).toHaveURL(/\/issues\/(?!new)[^/]+$/);
  const id = new URL(page.url()).pathname.split('/').at(-1);
  const issue = await (await page.request.get('/api/v1/issues/' + id)).json();
  expect(issue).toMatchObject({ estimate: 5, start_date: '2026-10-01', due_date: '2026-10-08' });
});
test('lost create response retries the identical request instead of duplicating an issue', async ({
  page,
}) => {
  await login(page);
  await newIssue(page, 'Ambiguous create response');
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
  await page.getByRole('button', { name: 'Create issue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry creation', exact: true })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveAttribute(
    'readonly',
    '',
  );
  await page.getByRole('button', { name: 'Retry creation', exact: true }).click();
  await expect(page).toHaveURL(/\/issues\/(?!new)[^/]+$/);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[0]).toBe(keys[1]);
  const issues = await (
    await page.request.get('/api/v1/issues?q=Ambiguous%20create%20response')
  ).json();
  expect(issues.data).toHaveLength(1);
});
test('newer text survives an earlier save response and a second commit', async ({ page }) => {
  await login(page);
  await newIssue(page, 'Concurrent editor test');
  await page.getByRole('button', { name: 'Create issue', exact: true }).click();
  await expect(page).toHaveURL(/\/issues\/(?!new)[^/]+$/);
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
        await page.getByRole('button', { name, exact: true }).click();
        await page.getByLabel(name + ' value', { exact: true }).fill(value);
        await page.getByRole('button', { name: 'Apply', exact: true }).click();
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
