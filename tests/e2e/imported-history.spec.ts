import { test, expect } from '@playwright/test';
import { browserHistoryFixture } from '../unit/activity-browser-fixture.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';

test('imported history uses source names and readable events on desktop and mobile', async ({
  page,
  browserName,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
  const { source, done } = browserHistoryFixture(browserName === 'webkit' ? 'HSW' : 'HSC');
  const headers = { Origin: new URL(page.url()).origin, 'x-tickets-csrf': '1' };
  const create = await page.request.post('/api/v1/imports/linear', {
    headers,
    data: { manifest: source.manifest },
  });
  expect(create.status()).toBe(201);
  const run = (await create.json()).id;
  for (const [collection, records] of Object.entries(source.data))
    if (records.length) {
      const response = await page.request.post(`/api/v1/imports/linear/${run}/records`, {
        headers,
        data: { collection, records },
      });
      expect(response.status()).toBe(200);
    }
  const plan = await page.request.post(`/api/v1/imports/linear/${run}/plan`, { headers });
  expect(plan.status()).toBe(200);
  const apply = await page.request.post(`/api/v1/imports/linear/${run}/apply`, {
    headers,
    data: { plan_hash: (await plan.json()).plan_hash },
  });
  expect(apply.status()).toBe(200);
  const me = await (await page.request.get('/api/v1/me')).json();
  const key = targetId(me.workspace_id, source.ids.org, 'issues', source.ids.issue);
  await page.goto('/issues/' + key);
  const activity = page.locator('.activity-section');
  // This is a geometry/history assertion, not an in-flight navigation-cancellation test.
  // Finish the current page's queries before reloading into another viewport in WebKit.
  await expect(activity).toContainText('changed status: Todo → Done');
  await page.waitForLoadState('networkidle');
  for (const width of [1280, 393]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await expect(activity).toContainText('changed status: Todo → Done');
    await expect(activity).toContainText('Linear updated the description');
    await expect(activity).toContainText('No priority → Urgent');
    await expect(activity).toContainText('added labels: Imported fixture');
    await expect(activity).toContainText('changed parent task: Unavailable task → No parent');
    await expect(activity).toContainText('archived the task');
    await expect(activity).not.toContainText(/\bissues?\b/i);
    await expect(activity).not.toContainText('linear_imported_change');
    await expect(activity).not.toContainText(done);
    await activity.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await activity.screenshot({ path: testInfo.outputPath(`history-${browserName}-${width}.png`) });
    await page.waitForLoadState('networkidle');
  }
  expect(errors).toEqual([]);
});
