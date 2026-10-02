import { test, expect } from '@playwright/test';

for (const from of ['Email', 'Password']) {
  test(`login Enter from ${from} opens the workspace`, async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
    await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
    const response = page.waitForResponse((r) => r.url().endsWith('/api/auth/login'));
    await page.getByLabel(from, { exact: true }).press('Enter');
    expect((await response).status()).toBe(200);
    await expect(page.getByTestId('issue-row').first()).toBeVisible();
    await expect(page).toHaveURL(/\/issues$/);
  });
}

test('Enter submits the actual browser/autofill values, not stale React state', async ({
  page,
}) => {
  await page.goto('/login');
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      document.querySelector('input[type=email]'),
      'demo@example.test',
    );
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      document.querySelector('input[type=password]'),
      'local-demo-password',
    );
  });
  const response = page.waitForResponse((r) => r.url().endsWith('/api/auth/login'));
  await page.getByLabel('Password', { exact: true }).press('Enter');
  expect((await response).status()).toBe(200);
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
});
