import { test, expect, type Page, type BrowserContext } from '@playwright/test';
let cookies: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;
async function login(page: Page) {
  if (cookies) {
    await page.context().addCookies(cookies);
    await page.goto('/issues');
  } else {
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
    await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
  cookies = await page.context().cookies();
}
test('phone text fields stay at least 16px without restricting user zoom', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await login(page);
    const search = page.getByPlaceholder('Search issues…');
    expect(
      await search.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(16);
    expect(await page.locator('meta[name=viewport]').getAttribute('content')).not.toMatch(
      /user-scalable\s*=\s*(no|0)|maximum-scale/,
    );
    await search.focus();
    expect(await page.evaluate(() => visualViewport?.scale)).toBe(1);
    await page.getByRole('button', { name: 'More navigation', exact: true }).click();
    await expect(page.locator('.sidebar').getByRole('link', { name: /Projects/ })).toContainText(
      /\d/,
    );
  } finally {
    await context.close();
  }
});
test('touch task lists scroll the document and keep header and translucent dock visible', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 393, height: 550 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await login(page);
    await page.evaluate(() => window.scrollTo(0, 500));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
    expect(await page.locator('.issues-content').evaluate((el) => el.scrollTop)).toBe(0);
    await expect(page.locator('.page-toolbar')).toBeInViewport();
    await expect(page.locator('.mobile-dock')).toBeInViewport();
    expect(
      await page.locator('.mobile-dock').evaluate((el) => getComputedStyle(el).backdropFilter),
    ).not.toBe('none');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      393,
    );
  } finally {
    await context.close();
  }
});
test('background list refresh holds new rows behind a badge and reveals existing changes one at a time', async ({
  page,
}) => {
  type Row = { id: string; title: string; key: string; version: number; [key: string]: unknown };
  let snapshot: { data: Row[]; [key: string]: unknown } | undefined,
    updated = false;
  await page.route('**/api/v1/issues?*', async (route) => {
    if (!snapshot) snapshot = await (await route.fetch()).json();
    const body = structuredClone(snapshot!);
    if (updated) {
      body.data[0] = {
        ...body.data[0],
        title: 'First remote change',
        version: body.data[0].version + 1,
      };
      body.data[1] = {
        ...body.data[1],
        title: 'Second remote change',
        version: body.data[1].version + 1,
      };
      body.data.unshift({
        ...body.data[0],
        id: '11111111-1111-4111-8111-111111111111',
        key: 'TKT-999',
        title: 'New incoming task',
        version: 1,
      });
    }
    await route.fulfill({ json: body });
  });
  await login(page);
  const before = await page.locator('.issue-row .issue-key').allTextContents();
  const anchor = page.getByTestId('issue-row').nth(5),
    y = (await anchor.boundingBox())!.y;
  await page.evaluate(() => {
    let maximum = 0;
    new MutationObserver(() => {
      maximum = Math.max(maximum, document.querySelectorAll('[data-update-active=true]').length);
      document.documentElement.dataset.maxUpdates = String(maximum);
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-update-active'],
    });
  });
  updated = true;
  await page.getByRole('button', { name: 'Issue actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Refresh issues', exact: true }).click();
  await expect(page.getByRole('button', { name: /1 new.*Review updates/ })).toBeVisible();
  expect(await page.locator('.issue-row .issue-key').allTextContents()).toEqual(before);
  expect(Math.abs((await anchor.boundingBox())!.y - y)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('button', { name: /First remote change/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Second remote change/ })).toBeVisible();
  expect(Number(await page.locator('html').getAttribute('data-max-updates'))).toBeLessThanOrEqual(
    1,
  );
  await expect(page.getByText('New incoming task', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Review updates/ }).click();
  await expect(page.getByText('New incoming task', { exact: true })).toBeVisible();
});

test('explicit Load more shows the requested page immediately without calling it a live arrival', async ({
  page,
}) => {
  let original: { data: Array<Record<string, unknown>> } | undefined;
  await page.route('**/api/v1/issues?*', async (route) => {
    if (!original) original = await (await route.fetch()).json();
    const row = original!.data[0];
    const next = new URL(route.request().url()).searchParams.get('cursor');
    await route.fulfill({
      json: next
        ? {
            data: [
              {
                ...row,
                id: '22222222-2222-4222-8222-222222222222',
                key: 'TKT-998',
                title: 'Explicitly requested next page',
              },
            ],
            next_cursor: null,
          }
        : { data: original!.data.slice(0, 2), next_cursor: 'fixture-next-page' },
    });
  });
  await login(page);
  await expect(page.getByTestId('issue-row')).toHaveCount(2);
  const before = await page.getByTestId('issue-row').first().boundingBox();
  await page.getByRole('button', { name: 'Load more issues', exact: true }).click();
  await expect(page.getByText('Explicitly requested next page', { exact: true })).toBeVisible();
  await expect(page.getByTestId('issue-row')).toHaveCount(3);
  await expect(page.getByRole('button', { name: /Review updates/ })).toHaveCount(0);
  expect((await page.getByTestId('issue-row').first().boundingBox())!.y).toBe(before!.y);
});

test('a closed command palette does not keep polling hidden issue search results', async ({
  page,
}) => {
  await page.clock.install();
  let reads = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/issues') reads++;
  });
  await login(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  const settledReads = reads;
  await page.clock.fastForward(16000);
  await page.waitForTimeout(150);
  expect(reads).toBe(settledReads);
});
