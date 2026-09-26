import { test, expect } from '@playwright/test';
import { login } from './session-fixture';
test('touch search remains readable without disabling pinch zoom', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await login(page);
    const search = page.getByPlaceholder('Search tasks…');
    expect(
      await search.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(16);
    expect(await page.locator('meta[name=viewport]').getAttribute('content')).not.toMatch(
      /user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1(?:[.,\s]|$)/,
    );
    await search.focus();
    expect(await page.evaluate(() => visualViewport?.scale)).toBe(1);
  } finally {
    await context.close();
  }
});
test('phone scrolls the document, with floating header and collapsing glass navigation', async ({
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
    await expect(page.locator('.mobile-navigation-bar')).toHaveAttribute('data-collapsed', 'true');
    expect(
      await page.locator('.mobile-dock').evaluate((el) => getComputedStyle(el).backdropFilter),
    ).not.toBe('none');
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('.mobile-navigation-bar')).toHaveAttribute('data-collapsed', 'false');
  } finally {
    await context.close();
  }
});
