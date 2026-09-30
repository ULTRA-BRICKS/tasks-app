import { test, expect, type Page } from '@playwright/test';
import { login } from './session-fixture';
import { teamSourceFixture } from '../unit/linear-import-fixture.mjs';
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
test('the task not-found state puts Retry below the message, full width on a phone', async ({
  page,
}) => {
  await login(page);
  const task = (await (await page.request.get('/api/v1/issues')).json()).data[0];
  const missing = '/tasks/' + task.key.replace(/\d+$/, '99999');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(missing);
    const alert = page.getByRole('alert').filter({ hasText: 'Task not found' });
    const message = alert.getByText('Task not found', { exact: true });
    const retry = alert.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeVisible();
    const [text, button, box] = await Promise.all([
      message.boundingBox(),
      retry.boundingBox(),
      alert.boundingBox(),
    ]);
    expect(button!.y).toBeGreaterThanOrEqual(text!.y + text!.height);
    // Retry starts where the message text starts, not after the icon column or beside the text.
    expect(Math.abs(button!.x - text!.x)).toBeLessThanOrEqual(1);
    if (width === 390) {
      expect(button!.height).toBeGreaterThanOrEqual(44);
      expect(button!.x + button!.width).toBeGreaterThanOrEqual(box!.x + box!.width - 14);
    }
  }
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

/** Imports a synthetic Linear team (Parent is <team>-7, Child <team>-8) and returns a renumber helper. */
async function importedSourceTeam(page: Page, team: string) {
  const source = teamSourceFixture(team);
  const headers = { Origin: new URL(page.url()).origin, 'x-tickets-csrf': '1' };
  const post = async (path: string, data?: unknown) => {
    const response = await page.request.post(path, { headers, data });
    expect(response.status(), path).toBeLessThan(300);
    return response.json();
  };
  const run = (await post('/api/v1/imports/linear', { manifest: source.manifest })).id;
  for (const [collection, records] of Object.entries(source.data))
    if (records.length)
      await post(`/api/v1/imports/linear/${run}/records`, { collection, records });
  const plan = await post(`/api/v1/imports/linear/${run}/plan`);
  await post(`/api/v1/imports/linear/${run}/apply`, { plan_hash: plan.plan_hash });
  return async (codes: { parent: string; child: string }) => {
    // The fixture's source updatedAt; the snapshot schema requires it on every record.
    const updated_at = '2024-02-03T04:05:06.007Z',
      team_id = source.ids.team;
    const input = {
      source_workspace_id: source.ids.org,
      records: [
        { source_id: source.ids.issue, code: codes.parent, team_id, updated_at },
        { source_id: source.ids.child, code: codes.child, team_id, updated_at },
      ],
    };
    const preview = await post('/api/v1/sync/linear/numbering', input);
    const applied = await post('/api/v1/sync/linear/numbering', {
      ...input,
      plan_hash: preview.plan_hash,
    });
    expect(applied.applied).toBe(true);
  };
}
test('a pre-canonical code link opens the renumbered task while the bare code keeps its holder', async ({
  page,
  browserName,
}) => {
  await login(page);
  const team = browserName === 'webkit' ? 'PCW' : 'PCC',
    old = team + '-7',
    next = team + '-8';
  const renumber = await importedSourceTeam(page, team);
  await renumber({ parent: next, child: old });
  let mutations = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method())) mutations++;
  });
  await page.goto('/tasks/pre-canonical/' + old.toLowerCase() + '-a-stale-title');
  await expect(
    page.getByRole('heading', { name: 'Pre-canonical ' + old, exact: true }),
  ).toBeVisible();
  const matches = page.getByRole('list', { name: 'Tasks that had ' + old });
  await expect(matches.getByRole('listitem').filter({ hasText: 'Parent' })).toContainText(
    old + ' → ' + next,
  );
  await expect(page.getByText('Today ' + old + ' opens')).toBeVisible();
  await matches.getByRole('link', { name: next + ' Parent' }).click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Parent');
  await expect(page.getByText(next, { exact: true }).first()).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'Pre-canonical ' + old, exact: true }),
  ).toBeVisible();
  await page.goto('/issues/pre-canonical/' + old + '/a-stale-title');
  await expect(page).toHaveURL(new RegExp('/tasks/pre-canonical/' + old + '/a-stale-title$'));
  await expect(
    page.getByRole('heading', { name: 'Pre-canonical ' + old, exact: true }),
  ).toBeVisible();
  await page.goto('/tasks/' + old);
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Child');
  await page.goto('/tasks/pre-canonical/' + team + '-99');
  await expect(
    page.getByRole('heading', {
      name: 'No task had ' + team + '-99 before canonical renumbering',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open current ' + team + '-99' })).toBeVisible();
  expect(mutations).toBe(0);

  await renumber({ parent: old, child: next });
  await page.goto('/tasks/pre-canonical/' + old);
  await expect(
    page.getByText(old + ' referred to 2 tasks before canonical renumbering'),
  ).toBeVisible();
  await expect(matches.getByRole('link')).toHaveText([
    new RegExp(next + '\\s*Child'),
    new RegExp(old + '\\s*Parent'),
  ]);
  await expect(matches.getByRole('listitem').filter({ hasText: 'Parent' })).toContainText(
    next + ' → ' + old,
  );
});
