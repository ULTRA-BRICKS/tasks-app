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
    await expect(page.getByTestId('issue-row').first()).toBeVisible();
    cookies = await page.context().cookies();
  }
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
}

for (const [label, width, touch] of [
  ['narrow desktop', 680, false],
  ['wide desktop', 1440, false],
  ['phone', 393, true],
  ['tablet', 1024, true],
] as const) {
  test(`${label} uses input-appropriate row density and visible separators`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width, height: 900 },
      hasTouch: touch,
    });
    const page = await context.newPage();
    try {
      await login(page);
      const row = page.getByTestId('issue-row').first();
      await expect(row).toBeVisible();
      const geometry = await row.evaluate((el) => {
        const css = getComputedStyle(el);
        return {
          height: el.getBoundingClientRect().height,
          border: css.borderBottomColor,
          width: parseFloat(css.borderBottomWidth),
          font: parseFloat(getComputedStyle(el.querySelector('.issue-open > span')!).fontSize),
          coarse: matchMedia('(pointer: coarse)').matches,
        };
      });
      expect(geometry.coarse).toBe(touch);
      const selection = (await row.locator('.issue-selection').boundingBox())!;
      const priority = (await row.locator('.priority-icon, .priority-urgent').boundingBox())!;
      expect(selection.x + selection.width).toBeLessThanOrEqual(priority.x);
      expect(geometry.height).toBeGreaterThanOrEqual(touch ? 52 : 36);
      expect(geometry.height).toBeLessThanOrEqual(touch ? 60 : 44);
      expect(geometry.width).toBe(1);
      expect(geometry.border).not.toMatch(/rgba\([^)]*,\s*0\)|transparent|\/\s*0\)/);
      if (touch) expect(geometry.font).toBeGreaterThanOrEqual(14);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    } finally {
      await context.close();
    }
  });
}

test('a desktop user can choose density and retain it across resize and reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 680, height: 900 });
  await login(page);
  const row = page.getByTestId('issue-row').first();
  await expect(row).toBeVisible();
  const height = () => row.evaluate((el) => el.getBoundingClientRect().height);
  expect(await height()).toBe(42);
  await page.getByRole('button', { name: 'Task actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Density: compact', exact: true }).click();
  await expect.poll(height).toBe(36);
  await page.reload();
  await expect(row).toBeVisible();
  expect(await height()).toBe(36);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await height()).toBe(36);
  await page.getByRole('button', { name: 'Task actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Density: comfortable', exact: true }).click();
  await expect.poll(height).toBe(56);
  await page.getByRole('button', { name: 'Task actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Density: auto', exact: true }).click();
  await expect.poll(height).toBe(42);
});

test('touch selection uses the full hit area without opening a preview or issue', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 393, height: 852 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await login(page);
    const row = page.getByTestId('issue-row').first();
    await expect(row).toBeVisible();
    const label = row.locator('.issue-selection');
    const area = (await label.boundingBox())!;
    expect(area.width).toBeGreaterThanOrEqual(44);
    expect(area.height).toBeGreaterThanOrEqual(44);
    await page.touchscreen.tap(area.x + 3, area.y + 3);
    await expect(row.getByRole('checkbox')).toBeChecked();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByRole('dialog', { name: 'Task preview', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Task actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Density: compact', exact: true }).click();
    await expect.poll(() => row.evaluate((el) => el.getBoundingClientRect().height)).toBe(48);
    expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  } finally {
    await context.close();
  }
});
