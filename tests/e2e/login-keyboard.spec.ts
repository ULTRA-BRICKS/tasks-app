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

test('same-tick submit is single-flight and a failed autofilled login remains retryable', async ({
  page,
}) => {
  let calls = 0,
    release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/auth/login', async (route) => {
    calls++;
    await pending;
    await route.fulfill({
      status: 401,
      json: { error: { code: 'INVALID_CREDENTIALS', message: 'Synthetic retryable rejection' } },
    });
  });
  await page.goto('/login');
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      document.querySelector('input[type=email]'),
      'autofill@example.test',
    );
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      document.querySelector('input[type=password]'),
      ' synthetic-password ',
    );
    const form = document.querySelector('form')!;
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(page.getByRole('button', { name: 'Signing in…', exact: true })).toBeDisabled();
  release();
  await expect(page.getByText('Synthetic retryable rejection')).toBeVisible();
  expect(calls).toBe(1);
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('autofill@example.test');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue(' synthetic-password ');
  await page.getByLabel('Password', { exact: true }).press('Enter');
  await expect.poll(() => calls).toBe(2);
});

test('autofilled email follows Forgot password without copying credentials to URL or storage', async ({
  page,
}) => {
  await page.goto('/login');
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      document.querySelector('input[type=email]'),
      'handoff@example.test',
    );
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      document.querySelector('input[type=password]'),
      'private-autofill-fixture',
    );
  });
  await page.getByRole('link', { name: 'Forgot password?', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('handoff@example.test');
  expect(page.url()).not.toContain('handoff');
  expect(page.url()).not.toContain('private-autofill-fixture');
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
        history: history.state,
      }).includes('private-autofill-fixture'),
    ),
  ).toBe(false);
  await page.getByRole('link', { name: 'Back to sign in', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('handoff@example.test');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
});

test('native required-field validation blocks an incomplete Enter without a request', async ({
  page,
}) => {
  let requests = 0;
  await page.route('**/api/auth/login', (route) => {
    requests++;
    return route.abort();
  });
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('incomplete@example.test');
  await page.getByLabel('Password', { exact: true }).press('Enter');
  expect(requests).toBe(0);
  expect(
    await page
      .getByLabel('Password', { exact: true })
      .evaluate((element) => (element as HTMLInputElement).validity.valueMissing),
  ).toBe(true);
});
