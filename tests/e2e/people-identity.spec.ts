import { test, expect, type Page } from '@playwright/test';
import { login } from './session-fixture';
type Person = { id: string; name: string; email: string };
const source = (id: string, name: string, email: string | null, provider: string) => ({
  id,
  name,
  email,
  avatar_url: null,
  provider,
  source_id: id,
});
/** Synthetic identities around the demo members: an email-matched Linear alias and a bound Slack
 * profile for Jamie, two Linear profiles sharing Sam's email, and a Linear OAuth app.
 * `samName` renames Sam's member record in the catalog only. */
async function identityFixture(page: Page, { samName }: { samName?: string } = {}) {
  await page.route('**/api/v1/catalog', async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const data = await response.json();
    const jamie = data.people.find((p: Person) => p.name === 'Jamie Chen');
    const sam = data.people.find((p: Person) => p.name === 'Sam Rivera');
    if (samName) sam.name = samName;
    data.source_people = [
      ...(data.source_people ?? []),
      source('aaaaaaaa-0000-4000-8000-000000000001', 'jchen', jamie.email.toUpperCase(), 'linear'),
      source('aaaaaaaa-0000-4000-8000-000000000002', 'Jamie C.', 'jamie@home.test', 'slack'),
      source('aaaaaaaa-0000-4000-8000-000000000003', 'Sam Rivera', sam.email, 'linear'),
      source('aaaaaaaa-0000-4000-8000-000000000004', 'Sam R. (old)', sam.email, 'linear'),
      {
        ...source(
          'aaaaaaaa-0000-4000-8000-000000000005',
          'Codex',
          'x@oauthapp.linear.app',
          'linear',
        ),
        bot: true,
      },
    ];
    data.identity_bindings = [
      {
        member_id: jamie.id,
        source_person_id: 'aaaaaaaa-0000-4000-8000-000000000002',
        via: 'slack_user_map',
      },
    ];
    await route.fulfill({ response, json: data });
  });
}
test('People settings mark a same-provider email conflict for review without write actions', async ({
  page,
}) => {
  await identityFixture(page);
  await login(page);
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes.push(request.method() + ' ' + request.url());
  });
  await page.goto('/settings?tab=members');
  const sam = page.locator('.member-row').filter({ hasText: 'Sam Rivera' });
  await expect(sam.getByText('Needs review', { exact: true })).toBeVisible();
  await expect(
    page.locator('.member-row').filter({ hasText: 'Jamie Chen' }).getByText('Needs review'),
  ).toHaveCount(0);
  const review = page.getByRole('region', { name: 'Identity review' });
  await expect(review).toBeVisible();
  // Other suites may import more Linear people into the shared e2e database; scope to Sam.
  const conflict = review
    .locator('.identity-conflict')
    .filter({ hasText: 'More than one Linear profile uses sam.rivera@example.test' });
  await expect(conflict).toHaveCount(1);
  const profiles = conflict.locator('.identity-profiles > li');
  await expect(profiles).toHaveCount(3);
  await expect(profiles.filter({ hasText: 'Member' })).toHaveCount(1);
  await expect(profiles.filter({ hasText: 'Sam R. (old)' })).toHaveCount(1);
  await expect(profiles.filter({ hasText: 'Linear' })).toHaveCount(2);
  await expect(review.getByRole('button')).toHaveCount(0);
  await expect(review.getByRole('combobox')).toHaveCount(0);
  await expect(review.getByRole('link')).toHaveCount(0);
  expect(writes).toEqual([]);
});
test('a Needs review marker that wraps on a narrow phone lines up with the member name', async ({
  page,
}) => {
  // A long name leaves no room for the marker beside it at the narrowest supported width.
  const longName = 'Samantha Rivera Castellanos';
  await page.setViewportSize({ width: 320, height: 700 });
  await identityFixture(page, { samName: longName });
  await login(page);
  await page.goto('/settings?tab=members');
  const sam = page.locator('.member-row').filter({ hasText: longName });
  const badge = sam.getByText('Needs review', { exact: true });
  await expect(badge).toBeVisible();
  // `strong` starts where the name's first line starts; the email line shares that left edge.
  const nameLine = await sam.locator('strong').boundingBox();
  const email = await sam.getByText('sam.rivera@example.test', { exact: true }).boundingBox();
  const marker = await badge.boundingBox();
  if (!nameLine || !email || !marker) throw new Error('member row is not laid out');
  expect(marker.y).toBeGreaterThanOrEqual(nameLine.y + marker.height);
  expect(Math.abs(marker.x - nameLine.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(marker.x - email.x)).toBeLessThanOrEqual(1);
  expect(marker.x + marker.width).toBeLessThanOrEqual(nameLine.x + nameLine.width + 1);
});
test('assignee picker lists each person once, labels conflicts and bots, and assigns the member', async ({
  page,
}) => {
  await identityFixture(page);
  await login(page);
  const catalog = await (await page.request.get('/api/v1/catalog')).json();
  const jamie = catalog.people.find((p: Person) => p.name === 'Jamie Chen');
  await page.locator('.issue-open').first().click();
  await page.getByRole('combobox', { name: 'Assignee', exact: true }).click();
  const options = page.getByRole('option');
  await expect(options.filter({ hasText: /Jamie|jchen/ })).toHaveCount(1);
  await expect(options.filter({ hasText: 'Jamie C.' })).toHaveCount(1);
  const sam = options.filter({ hasText: 'Sam R' });
  await expect(sam).toHaveCount(3);
  await expect(sam.filter({ hasText: 'Needs review' })).toHaveCount(3);
  await expect(
    options.filter({ hasText: 'Jamie C.' }).filter({ hasText: 'Needs review' }),
  ).toHaveCount(0);
  await expect(options.filter({ hasText: 'Codex' })).toHaveCount(1);
  await expect(options.filter({ hasText: 'Codex' })).toContainText('Bot');
  const saved = page.waitForRequest(
    (request) => request.method() === 'PATCH' && /\/api\/v1\/issues\//.test(request.url()),
  );
  await options.filter({ hasText: 'Jamie C.' }).click();
  expect((await saved).postDataJSON()).toMatchObject({ assignee_id: jamie.id });
});
test('task-list assignee filter offers one entry per person', async ({ page }) => {
  await identityFixture(page);
  await login(page);
  const catalog = await (await page.request.get('/api/v1/catalog')).json();
  const jamie = catalog.people.find((p: Person) => p.name === 'Jamie Chen');
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('combobox', { name: 'Filter by assignee' }).click();
  const options = page.getByRole('option');
  await expect(options.filter({ hasText: /Jamie|jchen/ })).toHaveCount(1);
  await options.filter({ hasText: 'Jamie C.' }).click();
  await expect(page).toHaveURL(new RegExp('assignee_id=' + jamie.id));
  await expect(page.getByRole('combobox', { name: 'Filter by assignee' })).toContainText(
    'Jamie C.',
  );
});
