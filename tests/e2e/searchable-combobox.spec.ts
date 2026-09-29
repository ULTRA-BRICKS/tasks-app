import { test, expect, type Page, type Request } from '@playwright/test';
import { login } from './session-fixture';

const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}`;
const csrf = { 'x-tickets-csrf': '1' };

async function openTask(page: Page) {
  await login(page);
  await page.locator('.issue-open').first().click();
  await expect(page).toHaveURL(/\/tasks\/[^/]+/);
  await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toBeEnabled();
}
function creations(page: Page, path: string) {
  const sent: Request[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === path) sent.push(request);
  });
  return sent;
}
async function labelsNamed(page: Page, name: string) {
  const catalog = await (await page.request.get('/api/v1/catalog')).json();
  return catalog.labels.filter((label: { name: string }) => label.name === name);
}

test('property pickers search, keep their value on Escape and show people avatars', async ({
  page,
}) => {
  await openTask(page);
  const url = page.url();
  const status = page.getByRole('combobox', { name: 'Status', exact: true });
  const before = (await status.textContent())?.trim();
  await status.click();
  const search = page.getByRole('combobox', { name: 'Search status' });
  await expect(search).toBeFocused();
  await expect(page.getByRole('listbox', { name: 'Status' })).toBeVisible();
  await search.pressSequentially('zzz-no-status');
  await expect(page.getByText('No matches')).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(status).toBeFocused();
  await expect(status).toHaveText(before ?? '');
  // Escape belonged to the picker, not to the task page's back navigation.
  expect(page.url()).toBe(url);

  const catalog = await (await page.request.get('/api/v1/catalog')).json();
  const person = catalog.people.find((p: { name: string }) => p.name === 'Jamie Chen');
  await page.getByRole('combobox', { name: 'Assignee', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search assignee' }).pressSequentially('jami');
  const option = page.getByRole('option', { name: person.name, exact: true });
  await expect(option.locator('.avatar')).toHaveText('JC');
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Assignee', exact: true })).toHaveText(
    person.name,
  );
});

test('labels are created only by the explicit Create option, and a lost response retries idempotently', async ({
  page,
}) => {
  await openTask(page);
  const name = unique('Needs design');
  const sent = creations(page, '/api/v1/labels');
  const trigger = page.getByRole('combobox', { name: 'Labels', exact: true });
  await trigger.click();
  const search = page.getByRole('combobox', { name: 'Search labels' });
  await search.pressSequentially(name);
  await expect(page.getByRole('option', { name: `Create label “${name}”` })).toBeVisible();
  await page.keyboard.press('Escape');
  await trigger.click();
  await page.getByRole('combobox', { name: 'Search labels' }).pressSequentially(name);
  await page.mouse.click(5, 5);
  await expect(page.getByRole('listbox')).toHaveCount(0);
  expect(sent).toHaveLength(0);
  expect(await labelsNamed(page, name)).toHaveLength(0);

  // The first response is lost after the server committed the label. The retry's refetch
  // fails too, so only the idempotency key stands between the retry and a duplicate.
  let dropped = false,
    catalogDown = false;
  await page.route('**/api/v1/labels', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    if (dropped) {
      catalogDown = false;
      return route.fallback();
    }
    dropped = true;
    await route.fetch();
    await route.abort('failed');
  });
  await page.route('**/api/v1/catalog', (route) =>
    catalogDown ? route.abort('failed') : route.fallback(),
  );
  await trigger.click();
  await page.getByRole('combobox', { name: 'Search labels' }).pressSequentially(name);
  await page.getByRole('option', { name: `Create label “${name}”` }).click();
  await expect(page.getByRole('alert')).toContainText('Couldn’t reach the server');
  await expect(page.getByRole('combobox', { name: 'Search labels' })).toHaveValue(name);
  catalogDown = true;
  await page.getByRole('option', { name: `Create label “${name}”` }).click();
  await expect(page.getByRole('option', { name, exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(sent).toHaveLength(2);
  const keys = sent.map((request) => request.headers()['idempotency-key']);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  expect(await labelsNamed(page, name)).toHaveLength(1);
  await page.keyboard.press('Escape');
  await expect(trigger).toContainText(name);
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Labels', exact: true })).toContainText(name);
});

test('a label created concurrently is selected instead of duplicated on 409', async ({ page }) => {
  await openTask(page);
  const name = unique('Race');
  await page.route('**/api/v1/labels', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    // Another person wins the race between our refetch and our create.
    const other = await page.request.post('/api/v1/labels', {
      headers: csrf,
      data: { name, color: '#22c55e' },
    });
    expect(other.status()).toBe(201);
    await route.continue();
  });
  const trigger = page.getByRole('combobox', { name: 'Labels', exact: true });
  await trigger.click();
  await page.getByRole('combobox', { name: 'Search labels' }).pressSequentially(name);
  const conflict = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/labels') && response.status() === 409,
  );
  await page.getByRole('option', { name: `Create label “${name}”` }).click();
  await conflict;
  // The notice is announced by the popup's polite live region (the empty state is another one).
  await expect(
    page.getByRole('status').filter({ hasText: `Selected existing label “${name}”` }),
  ).toHaveAttribute('aria-live', 'polite');
  await expect(page.getByRole('option', { name, exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(await labelsNamed(page, name)).toHaveLength(1);
});

test('a 409 whose winner cannot be listed yet explains itself and the retry selects it', async ({
  page,
}) => {
  await openTask(page);
  const name = unique('Race unlisted');
  let catalogDown = false;
  await page.route('**/api/v1/labels', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const other = await page.request.post('/api/v1/labels', {
      headers: csrf,
      data: { name, color: '#22c55e' },
    });
    expect(other.status()).toBe(201);
    // The list endpoint fails right when the conflict needs it.
    catalogDown = true;
    await route.continue();
  });
  await page.route('**/api/v1/catalog', (route) =>
    catalogDown ? route.abort('failed') : route.fallback(),
  );
  await page.getByRole('combobox', { name: 'Labels', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search labels' }).pressSequentially(name);
  await page.getByRole('option', { name: `Create label “${name}”` }).click();
  await expect(page.getByRole('alert')).toHaveText(
    `A label named “${name}” already exists. Try again to select it.`,
  );
  await expect(page.getByRole('combobox', { name: 'Search labels' })).toHaveValue(name);

  catalogDown = false;
  await page.getByRole('option', { name: `Create label “${name}”` }).click();
  await expect(page.getByRole('option', { name, exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(await labelsNamed(page, name)).toHaveLength(1);
});

test('project creation opens the page-first draft with the typed name and returns to the task', async ({
  page,
}) => {
  await openTask(page);
  const taskUrl = page.url();
  const name = unique('Q4 launch');
  const sent = creations(page, '/api/v1/projects');
  const project = page.getByRole('combobox', { name: 'Project', exact: true });
  await project.click();
  await page.getByRole('combobox', { name: 'Search project' }).pressSequentially(name);
  await page.getByRole('option', { name: `Create project “${name}”…` }).click();
  await expect(page).toHaveURL(/\/projects\/new$/);
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(name);
  expect(sent).toHaveLength(0);
  await page.getByRole('button', { name: 'Back to task' }).click();
  await expect(page).toHaveURL(taskUrl);
  expect(sent).toHaveLength(0);

  await project.click();
  await page.getByRole('combobox', { name: 'Search project' }).pressSequentially(name);
  await page.getByRole('option', { name: `Create project “${name}”…` }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  expect(sent).toHaveLength(1);
  await page.getByRole('button', { name: 'Back to task' }).click();
  await expect(page).toHaveURL(taskUrl);
  await page.getByRole('combobox', { name: 'Project', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search project' }).pressSequentially(name);
  await page.getByRole('option', { name, exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Project', exact: true })).toHaveText(name);
});

test('cycle creation from a new task keeps the unsent task draft for the return', async ({
  page,
}) => {
  await login(page);
  await page.goto('/tasks/new');
  const title = unique('Draft task');
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  const name = unique('Sprint');
  await page.getByRole('combobox', { name: 'Cycle', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search cycle' }).pressSequentially(name);
  await page.getByRole('option', { name: `Create cycle “${name}”…` }).click();
  await expect(page).toHaveURL(/\/cycles\/new$/);
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(name);
  // Dates are required, so nothing can be created from the picker itself.
  await expect(page.getByRole('button', { name: 'Create cycle' })).toBeDisabled();
  await page.getByRole('button', { name: 'Back to new task' }).click();
  await expect(page).toHaveURL(/\/tasks\/new$/);
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(title);
});

test('milestones are created inline in the task project', async ({ page }) => {
  await openTask(page);
  const name = unique('Public beta');
  const milestone = page.getByRole('combobox', { name: 'Milestone', exact: true });
  await milestone.click();
  await page.getByRole('combobox', { name: 'Search milestone' }).pressSequentially(name);
  await page.getByRole('option', { name: `Create milestone “${name}”` }).click();
  await expect(milestone).toHaveText(name);
  const milestones = await (await page.request.get('/api/v1/milestones')).json();
  expect(milestones.filter((m: { name: string }) => m.name === name)).toHaveLength(1);
});

test('viewers cannot create and a server 403 keeps the typed text', async ({ page }) => {
  await openTask(page);
  const name = unique('Denied');
  await page.route('**/api/v1/labels', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 403,
          json: { error: { code: 'READ_ONLY', message: 'Viewers cannot change workspace data' } },
        })
      : route.fallback(),
  );
  await page.getByRole('combobox', { name: 'Labels', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search labels' }).pressSequentially(name);
  await page.getByRole('option', { name: `Create label “${name}”` }).click();
  await expect(page.getByRole('alert')).toHaveText('You don’t have permission to create labels.');
  await expect(page.getByRole('combobox', { name: 'Search labels' })).toHaveValue(name);
  expect(await labelsNamed(page, name)).toHaveLength(0);
  await page.keyboard.press('Escape');

  await page.route('**/api/v1/me', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), role: 'viewer', scopes: ['read'] },
    });
  });
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Labels', exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Project', exact: true })).toBeDisabled();
});

test('offline disables Create without losing the typed text', async ({ page, context }) => {
  await openTask(page);
  const name = unique('Offline');
  const sent = creations(page, '/api/v1/labels');
  await page.getByRole('combobox', { name: 'Labels', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search labels' }).pressSequentially(name);
  await context.setOffline(true);
  const option = page.getByRole('option', { name: new RegExp(`Create label “${name}”`) });
  await expect(option).toHaveAttribute('aria-disabled', 'true');
  await expect(option).toContainText('Offline — reconnect to create');
  // Neither a pointer nor the keyboard can choose the disabled Create.
  await option.click({ force: true });
  await page.keyboard.press('Enter');
  expect(sent).toHaveLength(0);
  await context.setOffline(false);
  await expect(option).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('combobox', { name: 'Search labels' })).toHaveValue(name);
});
