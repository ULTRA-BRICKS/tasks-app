import { test, expect } from '@playwright/test';
import { login } from './session-fixture';
test('date properties keep one inline input and a compact calendar without an Apply form', async ({
  page,
}) => {
  await login(page);
  await page.goto('/tasks/new');
  let writes = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/') && !['GET', 'HEAD'].includes(request.method())) writes++;
  });
  const input = page.getByRole('textbox', { name: 'Start date', exact: true });
  await expect(input).toBeVisible();
  await input.fill('2026-10-20');
  await input.press('Enter');
  await page.getByRole('button', { name: 'Open start date calendar', exact: true }).click();
  const calendar = page.getByRole('dialog', { name: 'Start date calendar', exact: true });
  await expect(calendar).toBeVisible();
  await expect(calendar.locator('input')).toHaveCount(0);
  await expect(calendar.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);
  await calendar.getByRole('button', { name: 'October 21, 2026', exact: true }).click();
  await expect(input).toHaveValue('2026-10-21');
  await expect(calendar).toHaveCount(0);
  await expect(input).toBeFocused();
  expect(writes).toBe(0);
});
test('invalid typed dates remain recoverable and Escape cancels without silently normalizing', async ({
  page,
}) => {
  await login(page);
  await page.goto('/tasks/new');
  const input = page.getByRole('textbox', { name: 'Due date', exact: true });
  await input.fill('2026-01-31');
  await input.press('Enter');
  await input.fill('2026-02-31');
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(input).toHaveValue('2026-02-31');
  await input.press('Escape');
  await expect(input).toHaveValue('2026-01-31');
  await page.getByRole('button', { name: 'Open due date calendar', exact: true }).click();
  const calendar = page.getByRole('dialog', { name: 'Due date calendar', exact: true });
  await calendar.getByRole('button', { name: 'Next month', exact: true }).click();
  await expect(calendar.getByText('February 2026', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('2026-01-31');
  await page.keyboard.press('Escape');
  await expect(calendar).toHaveCount(0);
  await expect(input).toHaveValue('2026-01-31');
});

for (const timezoneId of ['Etc/GMT+12', 'Pacific/Kiritimati', 'Europe/Belgrade'])
  test(
    'calendar date navigation stays date-only in ' + timezoneId,
    async ({ browser }, testInfo) => {
      const context = await browser.newContext({
          viewport: { width: 320, height: 760 },
          hasTouch: true,
          timezoneId,
        }),
        page = await context.newPage();
      try {
        await login(page);
        await page.goto('/tasks/new');
        const input = page.getByRole('textbox', { name: 'Start date', exact: true });
        await input.fill('2024-02-29');
        await input.press('Enter');
        await page.getByRole('button', { name: 'Open start date calendar', exact: true }).click();
        const calendar = page.getByRole('dialog', { name: 'Start date calendar', exact: true });
        await expect(
          calendar.getByRole('button', { name: 'February 29, 2024', exact: true }),
        ).toBeFocused();
        await page.keyboard.press('Shift+PageDown');
        await expect(
          calendar.getByRole('button', { name: 'February 28, 2025', exact: true }),
        ).toBeFocused();
        const bounds = await calendar.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          320,
        );
        await calendar.screenshot({ path: testInfo.outputPath('compact-calendar.png') });
        await page.keyboard.press('Enter');
        await expect(input).toHaveValue('2025-02-28');
        await expect(calendar).toHaveCount(0);
      } finally {
        await context.close();
      }
    },
  );
test('a rejected existing-task date edit stays editable and can be retried without losing it', async ({
  page,
}) => {
  await login(page);
  await page.locator('.issue-open').first().click();
  const input = page.getByRole('textbox', { name: 'Due date', exact: true });
  // Browser projects share the fixture database; the second engine must make a real change.
  const changedDate = browserName === 'webkit' ? '2030-04-04' : '2030-04-03';
  await expect(input).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').at(-1),
    before = await (await page.request.get('/api/v1/issues/' + id)).json();
  let attempts = 0;
  await page.route('**/api/v1/issues/' + id, (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    attempts++;
    return attempts === 1
      ? route.fulfill({
          status: 409,
          json: { error: { code: 'VERSION_CONFLICT', message: 'Synthetic date conflict' } },
        })
      : route.continue();
  });
  await input.fill(changedDate);
  await input.press('Enter');
  await expect(page.getByText('Synthetic date conflict', { exact: true })).toBeVisible();
  await expect(input).toHaveValue(changedDate);
  expect((await (await page.request.get('/api/v1/issues/' + id)).json()).due_date).toBe(
    before.due_date,
  );
  await input.press('Enter');
  await expect
    .poll(async () => (await (await page.request.get('/api/v1/issues/' + id)).json()).due_date)
    .toBe(changedDate);
  expect(attempts).toBe(2);
});

test('the complete inline date remains readable on a320px phone', async ({ browser }) => {
  const context = await browser.newContext({
      viewport: { width: 320, height: 760 },
      hasTouch: true,
    }),
    page = await context.newPage();
  try {
    await login(page);
    await page.goto('/tasks/new');
    const input = page.getByRole('textbox', { name: 'Start date', exact: true });
    await input.fill('2026-10-20');
    const width = await input.evaluate((el) => {
      const css = getComputedStyle(el),
        canvas = document.createElement('canvas'),
        ctx = canvas.getContext('2d')!;
      ctx.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
      return {
        available: el.clientWidth,
        required:
          ctx.measureText((el as HTMLInputElement).value).width +
          parseFloat(css.paddingLeft) +
          parseFloat(css.paddingRight),
      };
    });
    expect(width.available, JSON.stringify(width)).toBeGreaterThanOrEqual(width.required);
  } finally {
    await context.close();
  }
});
