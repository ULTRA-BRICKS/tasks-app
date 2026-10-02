import { test, expect } from '@playwright/test';

test('state-lib pilot: real preferences, reload and mobile navigation preserve the baseline UI', async ({
  page,
}, info) => {
  const backend = process.env.VITE_STATE_BACKEND === 'baseline' ? 'baseline' : 'state-lib';
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const original = Object.getOwnPropertyDescriptor(Storage.prototype, 'getItem')!
      .value as Storage['getItem'];
    let reads = 0;
    Storage.prototype.getItem = function (key) {
      if (key === 'tickets-ui') reads++;
      return original.call(this, key);
    };
    Object.defineProperty(window, '__preferenceStorageReads', { get: () => reads });
  });
  await page.goto('/issues');
  await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All issues', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-preference-backend', backend);
  expect(await page.evaluate(() => Reflect.get(window, '__preferenceStorageReads'))).toBe(1);
  await page.getByRole('button', { name: 'Board view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Board view', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Board view', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({ path: info.outputPath(`${backend}-board.png`), animations: 'disabled' });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/issues');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Navigation', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Navigation', exact: true })).not.toBeVisible();
  await page.screenshot({ path: info.outputPath(`${backend}-mobile.png`), animations: 'disabled' });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tickets-ui')!))).toEqual({
    state: { theme: 'light', view: 'board', density: 'auto' },
    version: 0,
  });
  expect(errors).toEqual([]);
});
