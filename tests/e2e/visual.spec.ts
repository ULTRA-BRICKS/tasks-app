import { test, expect, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.clock.setFixedTime(new Date('2026-09-10T10:00:00Z'));
  await page.goto('/issues');
  await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
  await page.waitForTimeout(200);
}
test('issue list — dark desktop', async ({ page }) => {
  await login(page);
  await expect(page).toHaveScreenshot('issues-dark.png');
});
test('issue board — dark desktop', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Board view' }).click();
  await expect(page.locator('.issue-card').first()).toBeVisible();
  await expect(page).toHaveScreenshot('board-dark.png');
});
test('issue detail — long description and property rail', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /Preserve drafts when switching/ }).click();
  await expect(page.getByLabel('Title', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot('issue-detail.png');
});
test('issue list — narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await login(page);
  await expect(page).toHaveScreenshot('issues-mobile.png');
});
test('new issue — inline document page', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'New issue', exact: true }).click();
  await expect(page).toHaveURL(/\/issues\/new$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.document-description[contenteditable=true]')).toBeVisible();
  await expect(page).toHaveScreenshot('create-issue.png');
});

test('issue list — touch phone keeps readable text and separators', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 393, height: 852 },
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await login(page);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    await expect(page).toHaveScreenshot('issues-touch.png');
  } finally {
    await context.close();
  }
});
