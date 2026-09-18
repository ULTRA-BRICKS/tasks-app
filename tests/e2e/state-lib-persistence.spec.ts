import { test, expect, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('/issues');
  await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All issues', exact: true })).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: 'Light', exact: true })).toBeVisible();
}
test('state-lib storage failure is visible, retains the choice and retries without a reload', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem')!
      .value as Storage['setItem'];
    Reflect.set(window, '__failPrefs', true);
    Storage.prototype.setItem = function (key, value) {
      if (key === 'tickets-ui' && Reflect.get(window, '__failPrefs'))
        throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await login(page);
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByTestId('preference-persistence-status')).toContainText('not saved');
  await page.evaluate(() => Reflect.set(window, '__failPrefs', false));
  await page.getByRole('button', { name: 'Retry saving settings', exact: true }).click();
  await expect(page.getByTestId('preference-persistence-status')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
test('state-lib follows a real second-tab storage event and preserves an unsupported version', async ({
  page,
  context,
}) => {
  await login(page);
  const other = await context.newPage();
  await other.goto('/settings');
  await expect(other.getByRole('button', { name: 'Light', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'light');
  await other.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const future = JSON.stringify({
    state: { theme: 'dark', view: 'list', density: 'auto', future: 'retain' },
    version: 99,
  });
  await page.evaluate((raw) => localStorage.setItem('tickets-ui', raw), future);
  await expect(other.getByTestId('preference-persistence-status')).toBeVisible();
  await other.getByRole('button', { name: 'Light', exact: true }).click();
  expect(await other.evaluate(() => localStorage.getItem('tickets-ui'))).toBe(future);
  await page.evaluate(() =>
    localStorage.setItem(
      'tickets-ui',
      JSON.stringify({ state: { theme: 'dark', view: 'list', density: 'auto' }, version: 0 }),
    ),
  );
  await expect(other.getByTestId('preference-persistence-status')).toContainText(
    'Another tab changed settings',
  );
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'light');
  await other.getByRole('button', { name: 'Retry saving settings', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await other.close();
});
