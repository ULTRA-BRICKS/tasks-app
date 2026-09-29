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
// A literal method: a typo would otherwise match nothing and pass every "sent nothing" check.
function requests(page: Page, method: 'POST' | 'PATCH', path: string | RegExp) {
  const sent: Request[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      request.method() === method &&
      (typeof path === 'string' ? pathname === path : path.test(pathname))
    )
      sent.push(request);
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
  const sent = requests(page, 'POST', '/api/v1/labels');
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
  const sent = requests(page, 'POST', '/api/v1/projects');
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
  const sent = requests(page, 'POST', '/api/v1/labels');
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

// Real touch input at phone size. Base UI cancels an option's pointerdown (the search field
// keeps focus) and chooses on the click that follows the tap, as iOS Safari and Android Chrome
// dispatch it. Playwright's WebKit is not iOS: its emulated tap drops that click, so only
// Chromium can prove a tap here (docs/SEARCHABLE-COMBOBOX.md, Touch selection).
test.describe('touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test.skip(
    ({ browserName }) => browserName === 'webkit',
    'Emulated WebKit taps never click an option whose pointerdown was cancelled',
  );

  // The last unselected option: commands such as View profile lead the list and are not values.
  async function tapUnselected(page: Page, listbox: string) {
    const option = page
      .getByRole('listbox', { name: listbox })
      .getByRole('option', { selected: false })
      .last();
    const name = (await option.locator('.picker-item-text').innerText()).trim();
    await option.tap();
    return name;
  }

  // A second choice from the same tap follows within a frame or two of the first save, so the
  // count is checked again after this quiet period instead of only when it first matches.
  const DOUBLE_SAVE_SETTLE_MS = 500;
  async function expectSaves(page: Page, sent: Request[], count: number) {
    await expect.poll(() => sent.length).toBe(count);
    await page.waitForTimeout(DOUBLE_SAVE_SETTLE_MS);
    expect(sent).toHaveLength(count);
  }

  test('a tap chooses exactly one option in the row, property and label pickers', async ({
    page,
  }) => {
    await login(page);
    const sent = requests(page, 'PATCH', /^\/api\/v1\/issues\//);
    const row = page.getByTestId('issue-row').first();
    const assignee = row.getByRole('combobox', { name: /^Assignee for / });
    await assignee.tap();
    // The popup's listbox shares the trigger's label.
    const listbox = (await assignee.getAttribute('aria-label')) ?? '';
    const person = await tapUnselected(page, listbox);
    // `Assignee for UB-1: Jamie Chen` names the trigger after its current value, `Unassigned`
    // included (assignee.tsx), so the label always has one `: `; keys have no colon.
    await expect(assignee).toHaveAccessibleName(
      listbox.slice(0, listbox.indexOf(': ') + 2) + person,
    );
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expectSaves(page, sent, 1);

    await page.locator('.issue-open').first().click();
    const status = page.getByRole('combobox', { name: 'Status', exact: true });
    await expect(status).toBeEnabled();
    await status.tap();
    const chosen = await tapUnselected(page, 'Status');
    await expect(status).toHaveText(chosen);
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expectSaves(page, sent, 2);

    // Multiple choice stays open, and each tap toggles the label exactly once.
    await page.getByRole('combobox', { name: 'Labels', exact: true }).tap();
    const label = await tapUnselected(page, 'Labels');
    const option = page.getByRole('option', { name: label, exact: true });
    await expect(option).toHaveAttribute('aria-selected', 'true');
    await expectSaves(page, sent, 3);
    await option.tap();
    await expect(option).toHaveAttribute('aria-selected', 'false');
    await expectSaves(page, sent, 4);
    await expect(page.getByRole('listbox', { name: 'Labels' })).toBeVisible();
  });

  test('a swipe over the options scrolls the list and chooses nothing', async ({ page }) => {
    await openTask(page);
    const sent = requests(page, 'PATCH', /^\/api\/v1\/issues\//);
    const estimate = page.getByRole('combobox', { name: 'Estimate', exact: true });
    // Mid-screen, clear of the dock, like a person tapping it.
    await estimate.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await estimate.tap();
    const list = page.locator('.combobox-list');
    await expect(list).toBeVisible();
    // The phone popup is capped at 340px, so the nine estimates overflow it.
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    const start = await page.getByRole('option').nth(2).boundingBox();
    if (!start) throw new Error('The third estimate has no box');
    // The finger lands on an option and drags upwards.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.synthesizeScrollGesture', {
      x: Math.round(start.x + start.width / 2),
      y: Math.round(start.y + start.height / 2),
      yDistance: -120,
      speed: 600,
      gestureSourceType: 'touch',
    });
    await cdp.detach();
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(page.getByRole('listbox', { name: 'Estimate' })).toBeVisible();
    await expect(page.getByRole('option', { selected: true })).toHaveCount(1);
    expect(sent).toHaveLength(0);

    // The list still takes a tap after the swipe.
    const chosen = await tapUnselected(page, 'Estimate');
    await expect(estimate).toHaveText(chosen);
    await expectSaves(page, sent, 1);
  });
});
