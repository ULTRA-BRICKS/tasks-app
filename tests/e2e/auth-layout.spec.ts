import { test, expect } from '@playwright/test';

test('phone login has a separate recovery action and usable controls', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/login');
  const recovery = page.getByRole('link', { name: 'Forgot password?', exact: true });
  const password = page.getByLabel('Password', { exact: true });
  const linkBox = (await recovery.boundingBox())!,
    inputBox = (await password.boundingBox())!;
  expect(linkBox.y + linkBox.height).toBeLessThanOrEqual(inputBox.y);
  expect(linkBox.height).toBeGreaterThanOrEqual(44);
  for (const control of [
    password,
    page.getByLabel('Email', { exact: true }),
    page.getByRole('button', { name: 'Continue', exact: true }),
  ]) {
    const box = (await control.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(48);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  expect(
    await password.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
});

test('email follows the recovery route but the password is not copied', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('layout-fixture@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-ui-only-password');
  await page.getByRole('link', { name: 'Forgot password?', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(
    'layout-fixture@example.test',
  );
  await page.getByRole('link', { name: 'Back to sign in', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(
    'layout-fixture@example.test',
  );
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 393, height: 480 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test(`auth screens fit ${viewport.width}x${viewport.height} without clipped content`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    for (const path of ['/login', '/forgot-password', '/reset-password', '/invite']) {
      await page.goto(path);
      await expect(page.locator('.auth-card')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const box = (await page.locator('.auth-card').boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(20);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 20);
      expect(box.width).toBeLessThanOrEqual(384);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
      const lastControl = page.locator('.auth-card').locator('button,a').last();
      await lastControl.scrollIntoViewIfNeeded();
      await expect(lastControl).toBeInViewport();
    }
  });
}

test('login recovery is reachable by keyboard before submitting credentials', async ({
  page,
  browserName,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).focus();
  // macOS Safari uses Option-Tab for links by default (Apple Safari keyboard shortcuts).
  await page.keyboard.press(
    browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab',
  );
  await expect(page.getByRole('link', { name: 'Forgot password?', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/forgot-password$/);
});

test('recovery link uses muted text without losing its tap target', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/login');
  const link = page.getByRole('link', { name: 'Forgot password?', exact: true });
  await expect(link).toBeVisible();
  const colors = await page.evaluate(() => ({
    link: getComputedStyle(document.querySelector('.auth-recovery-link')!).color,
    secondary: getComputedStyle(document.querySelector('.auth-intro')!).color,
    primary: getComputedStyle(document.querySelector('h1')!).color,
  }));
  expect(colors.link).toBe(colors.secondary);
  expect(colors.link).not.toBe(colors.primary);
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test('accepted synthetic invitation carries email but not password into login', async ({
  page,
}) => {
  await page.route('**/api/auth/accept-invite', (route) =>
    route.fulfill({ status: 200, json: { email: 'invite-layout@example.test' } }),
  );
  await page.goto('/invite#token=synthetic-layout-only');
  await page.getByLabel('Your name', { exact: true }).fill('Layout fixture');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-layout-password');
  await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await page.getByRole('link', { name: 'Continue to sign in', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('invite-layout@example.test');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
});

test('expired reset response leaves an accessible full-size retry link', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.route('**/api/auth/reset-password', (route) =>
    route.fulfill({
      status: 410,
      json: { error: { code: 'RESET_LINK_INVALID', message: 'This synthetic link has expired.' } },
    }),
  );
  await page.goto('/reset-password#token=' + 'T'.repeat(43));
  await page.getByLabel('New password', { exact: true }).fill('synthetic-layout-password');
  await page.getByLabel('Confirm new password', { exact: true }).fill('synthetic-layout-password');
  await page.getByRole('button', { name: 'Set new password', exact: true }).click();
  const retry = page.getByRole('link', { name: 'Request a new reset link', exact: true });
  await expect(retry).toBeVisible();
  expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await retry.click();
  await expect(page).toHaveURL(/\/forgot-password$/);
});
