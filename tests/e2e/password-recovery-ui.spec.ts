import { test, expect } from '@playwright/test';

test('forgot-password is reachable from login and keeps the email on service failure', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password?', exact: true }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(
    page.getByRole('heading', { name: 'Forgot your password?', exact: true }),
  ).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Email', exact: true });
  await input.fill('recovery-ui@example.test');
  await expect(input).toHaveValue('recovery-ui@example.test');
  // The normal synthetic test server intentionally has no provider credentials.
  await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
  await expect(
    page.getByText('Account email is not configured. Contact the workspace owner.'),
  ).toBeVisible();
  await expect(input).toHaveValue('recovery-ui@example.test');
});

test('an incomplete recovery URL cannot change account data', async ({ page }) => {
  let writes = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/auth/reset-password')) writes++;
  });
  await page.goto('/reset-password#token=incomplete');
  await expect(
    page.getByText('This link is incomplete. Request a new one. Your account has not changed.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set new password' })).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe('');
  expect(writes).toBe(0);
});

test('password confirmation is required and recovery credentials are never saved as drafts', async ({
  page,
}) => {
  let writes = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/auth/reset-password')) writes++;
  });
  const fixtureToken = 'T'.repeat(43);
  await page.goto('/reset-password#token=' + fixtureToken);
  await page.getByLabel('New password', { exact: true }).fill('synthetic-new-password-one');
  await page
    .getByLabel('Confirm new password', { exact: true })
    .fill('synthetic-different-password');
  await expect(page.getByRole('button', { name: 'Set new password' })).toBeDisabled();
  await expect(page.getByRole('alert')).toHaveText('The passwords do not match.');
  expect(new URL(page.url()).hash).toBe('');
  expect(writes).toBe(0);
  const retained = await page.evaluate(() => {
    for (const storage of [sessionStorage, localStorage])
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i),
          value = key ? (storage.getItem(key) ?? '') : '';
        if (value.includes('synthetic-new-password-one') || value.includes('T'.repeat(43)))
          return true;
      }
    return false;
  });
  expect(retained).toBe(false);
});
