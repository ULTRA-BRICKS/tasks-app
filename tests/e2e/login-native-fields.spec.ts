import { test, expect } from '@playwright/test';
test('Enter submits silent autofill values and preserves them when sign-in is rejected', async ({
  page,
}) => {
  const bodies: unknown[] = [];
  await page.route('**/api/auth/login', (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({
      status: 401,
      json: { error: { code: 'INVALID_CREDENTIALS', message: 'Synthetic rejection' } },
    });
  });
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).waitFor();
  await page.evaluate(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      document.querySelector('input[type=email]'),
      ' autofill@example.test ',
    );
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      document.querySelector('input[type=password]'),
      ' significant spaces ',
    );
  });
  await page.getByLabel('Password', { exact: true }).press('Enter');
  await expect(page.getByText('Synthetic rejection')).toBeVisible();
  expect(bodies).toEqual([{ email: 'autofill@example.test', password: ' significant spaces ' }]);
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('autofill@example.test');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue(' significant spaces ');
});
test('two submissions in one browser task send only one request', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/auth/login', (route) => {
    requests++;
    return route.fulfill({
      status: 401,
      json: { error: { code: 'INVALID_CREDENTIALS', message: 'Synthetic rejection' } },
    });
  });
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('once@example.test');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-only');
  await page.locator('form').evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
    (form as HTMLFormElement).requestSubmit();
  });
  await expect(page.getByText('Synthetic rejection')).toBeVisible();
  expect(requests).toBe(1);
});
test('Forgot password carries the actual autofilled email without putting the password in history', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).waitFor();
  await page.evaluate(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      document.querySelector('input[type=email]'),
      'handoff@example.test',
    );
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      document.querySelector('input[type=password]'),
      'private-synthetic-value',
    );
  });
  await page.getByRole('link', { name: 'Forgot password?', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('handoff@example.test');
  expect(page.url()).not.toContain('handoff');
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        history: history.state,
        local: Object.fromEntries(
          Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]),
        ),
        session: Object.fromEntries(
          Object.keys(sessionStorage).map((key) => [key, sessionStorage.getItem(key)]),
        ),
      }),
    ),
  ).not.toContain('private-synthetic-value');
});
test('failed native login remains retryable and incomplete forms never submit', async ({
  page,
}) => {
  let requests = 0;
  await page.route('**/api/auth/login', (route) => {
    requests++;
    return route.fulfill({
      status: 401,
      json: { error: { code: 'INVALID_CREDENTIALS', message: 'Synthetic rejection' } },
    });
  });
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('retry@example.test');
  await page.getByLabel('Password', { exact: true }).press('Enter');
  expect(requests).toBe(0);
  await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
  await page.getByLabel('Password', { exact: true }).press('Enter');
  await expect(page.getByText('Synthetic rejection')).toBeVisible();
  await page.getByLabel('Password', { exact: true }).press('Enter');
  await expect.poll(() => requests).toBe(2);
});

test('editing one field after silent autofill does not erase the other field', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).waitFor();
  await page.evaluate(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      document.querySelector('input[type=email]'),
      'mixed@example.test',
    );
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      document.querySelector('input[type=password]'),
      'old-synthetic-password',
    );
  });
  await page.getByLabel('Password', { exact: true }).fill('edited-synthetic-password');
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('mixed@example.test');
});
