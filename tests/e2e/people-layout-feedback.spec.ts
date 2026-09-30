import { test, expect, type Page } from '@playwright/test';
import { login } from './session-fixture';
const photo = '/synthetic-avatar.svg';
const sourceId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
async function duplicatePeople(page: Page) {
  await page.route('**/synthetic-avatar.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#5865f2"/></svg>',
    }),
  );
  await page.route('**/api/v1/catalog', async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const data = await response.json();
    const person = data.people[0];
    data.people[0] = { ...person, avatar_url: photo };
    data.source_people = [
      ...(data.source_people ?? []),
      {
        id: sourceId,
        name: person.name,
        email: person.email,
        avatar_url: photo,
        provider: 'linear',
        source_id: 'old-linear-author',
      },
    ];
    await route.fulfill({ response, json: data });
  });
}
test('assignee picker deduplicates one member/source pair without imported labels and renders avatar suggestions', async ({
  page,
}) => {
  await duplicatePeople(page);
  await login(page);
  const catalog = await (await page.request.get('/api/v1/catalog')).json();
  const member = catalog.people[0];
  await page.locator('.issue-open').first().click();
  await page.getByRole('combobox', { name: 'Assignee', exact: true }).click();
  await expect(page.getByRole('option').filter({ hasText: member.name })).toHaveCount(1);
  await expect(page.getByRole('option').filter({ hasText: '· imported' })).toHaveCount(0);
  await expect(
    page.getByRole('option').filter({ hasText: member.name }).locator('img'),
  ).toHaveAttribute('src', photo);
});
test('task row assignee is a keyboard-accessible picker, not an inert avatar or task navigation', async ({
  page,
}) => {
  await duplicatePeople(page);
  await login(page);
  const row = page.getByTestId('issue-row').first();
  const before = page.url();
  await row.getByRole('combobox', { name: /Assignee/ }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  expect(page.url()).toBe(before);
  await expect(page.getByRole('option', { name: 'Unassigned', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(row.getByRole('combobox', { name: /Assignee/ })).toBeFocused();
});
for (const width of [320, 393, 430])
  test(`task detail contains long people and links without horizontal drift at ${width}px`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width, height: 760 }, hasTouch: true });
    const page = await context.newPage();
    try {
      await page.route('**/api/v1/catalog', async (route) => {
        const response = await route.fetch();
        if (!response.ok()) return route.fulfill({ response });
        const data = await response.json();
        data.source_people = [
          {
            id: sourceId,
            name: 'Very long person ' + 'LongName'.repeat(16),
            email: 'long-person@example.test',
            avatar_url: null,
            provider: 'linear',
            source_id: 'long-source',
          },
        ];
        await route.fulfill({ response, json: data });
      });
      await page.route(/\/api\/v1\/issues\/[a-f0-9-]+$/, async (route) => {
        const response = await route.fetch(),
          data = await response.json();
        await route.fulfill({
          response,
          json: {
            ...data,
            assignee_id: sourceId,
            description: 'A long URL: https://example.test/' + 'unbroken'.repeat(90),
          },
        });
      });
      await login(page);
      await page.locator('.issue-open').first().click();
      await expect(page.getByRole('combobox', { name: 'Assignee', exact: true })).toBeVisible();
      const dimensions = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        scale: visualViewport?.scale,
        overflow: [
          ...document.querySelectorAll('main,aside,.detail-layout,.compact-property,.picker'),
        ]
          .map((el) => ({
            class: el.className,
            width: Math.round(el.getBoundingClientRect().width),
            right: Math.round(el.getBoundingClientRect().right),
          }))
          .filter((el) => el.right > innerWidth + 1),
      }));
      expect(dimensions, JSON.stringify(dimensions)).toMatchObject({ width, scale: 1 });
      expect(dimensions.scroll, JSON.stringify(dimensions)).toBeLessThanOrEqual(width + 1);
      await page.evaluate(() => window.scrollTo({ top: 700, left: 100 }));
      expect(await page.evaluate(() => scrollX)).toBe(0);
    } finally {
      await context.close();
    }
  });
test('row assignment changes only the chosen task and rolls back a rejected change', async ({
  page,
}) => {
  await login(page);
  const catalog = await (await page.request.get('/api/v1/catalog')).json(),
    target =
      catalog.people.find((person: { name: string }) => person.name === 'Sam Rivera') ??
      catalog.people[1];
  const row = page.getByTestId('issue-row').first(),
    key = await row.locator('.issue-key').innerText(),
    url = page.url();
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && /\/api\/v1\/issues\//.test(response.url()),
  );
  await row.getByRole('combobox', { name: /Assignee/ }).click();
  await page.getByRole('option', { name: target.name, exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(200);
  const changed = await response.json();
  expect(changed.key).toBe(key);
  expect(changed.assignee_id).toBe(target.id);
  expect(page.url()).toBe(url);
  await expect(row.getByRole('combobox', { name: /Assignee/ })).toHaveAccessibleName(
    new RegExp(target.name),
  );
  await page.route('**/api/v1/issues/' + changed.id, (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({
          status: 409,
          json: {
            error: { code: 'VERSION_CONFLICT', message: 'Synthetic conflict preserves assignment' },
          },
        })
      : route.continue(),
  );
  await row.getByRole('combobox', { name: /Assignee/ }).click();
  await page.getByRole('option', { name: 'Unassigned', exact: true }).click();
  await expect(row.getByRole('alert')).toContainText('Synthetic conflict preserves assignment');
  await expect(row.getByRole('combobox', { name: /Assignee/ })).toHaveAccessibleName(
    new RegExp(target.name),
  );
});
test('viewer can inspect assignee suggestions without an enabled assignment or mutation', async ({
  page,
}) => {
  await page.route('**/api/v1/me', async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, role: 'viewer', scopes: ['read'] } });
  });
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() === 'PATCH') writes++;
  });
  await login(page);
  await page
    .getByTestId('issue-row')
    .first()
    .getByRole('combobox', { name: /Assignee/ })
    .click();
  await expect(page.getByRole('listbox')).toBeVisible();
  // Every assignment is disabled; View profile (UB-77) only shows the assignee's card.
  const assignments = page.getByRole('option').filter({ hasNotText: 'View profile' });
  expect(await assignments.count()).toBeGreaterThan(0);
  for (const option of await assignments.all())
    await expect(option).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Enter');
  expect(writes).toBe(0);
  await page.keyboard.press('Escape');
});
test('long assignee and start-date popup stay inside a narrow viewport', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 760 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await login(page);
    await page.locator('.issue-open').first().click();
    await page.getByRole('button', { name: 'Open start date calendar', exact: true }).click();
    const popup = page.getByRole('dialog', { name: 'Start date calendar', exact: true });
    await expect(popup).toBeVisible();
    const bounds = await popup.boundingBox(),
      input = await page.getByRole('textbox', { name: 'Start date', exact: true }).boundingBox();
    expect(bounds).not.toBeNull();
    expect(input).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    expect(input!.x).toBeGreaterThanOrEqual(0);
    expect(input!.x + input!.width).toBeLessThanOrEqual(320);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);
  } finally {
    await context.close();
  }
});
