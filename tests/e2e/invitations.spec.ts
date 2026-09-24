import { test, expect, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
}
test('People queues email and displays pending invitations without asking to forward a link', async ({
  page,
}) => {
  const invitations: object[] = [];
  let requests = 0;
  await page.route('**/api/auth/options', (route) =>
    route.fulfill({ json: { passwordReset: true } }),
  );
  await page.route('**/api/v1/invitations', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: invitations });
    requests++;
    const input = route.request().postDataJSON();
    expect(input.delivery).toBe('email');
    expect(route.request().headers()['idempotency-key']).toBeTruthy();
    invitations.push({
      id: 'synthetic-invite',
      email: input.email,
      role: input.role,
      created_at: '2026-09-24T10:00:00Z',
      expires_at: '2026-10-01T10:00:00Z',
      status: 'pending',
    });
    await route.fulfill({ status: 201, json: { email: input.email, email_queued: true } });
  });
  await login(page);
  await page.goto('/settings?tab=members');
  await page.getByLabel('Invite email', { exact: true }).fill('teammate@example.test');
  await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
  await expect(page.getByText('Pending acceptance', { exact: true })).toBeVisible();
  expect(await page.locator('.invitation-row').evaluate((el) => getComputedStyle(el).display)).toBe(
    'grid',
  );
  await expect(page.getByText('teammate@example.test', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Invitation link' })).toHaveCount(0);
  expect(requests).toBe(1);
});
test('People keeps unsent email after an error and does not claim email delivery', async ({
  page,
}) => {
  await page.route('**/api/auth/options', (route) =>
    route.fulfill({ json: { passwordReset: true } }),
  );
  await page.route('**/api/v1/invitations', (route) =>
    route.fulfill(
      route.request().method() === 'GET'
        ? { json: [] }
        : {
            status: 503,
            json: { error: { code: 'MAIL_UNAVAILABLE', message: 'Synthetic mail unavailable' } },
          },
    ),
  );
  await login(page);
  await page.goto('/settings?tab=members');
  await page.getByLabel('Invite email', { exact: true }).fill('retry@example.test');
  await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
  await expect(page.getByText('Synthetic mail unavailable')).toBeVisible();
  await expect(page.getByLabel('Invite email', { exact: true })).toHaveValue('retry@example.test');
  await expect(page.getByText(/Invitation email queued/)).toHaveCount(0);
});

test('silently autofilled recipient survives a rejected email invitation', async ({ page }) => {
  await page.route('**/api/auth/options', (route) =>
    route.fulfill({ json: { passwordReset: true } }),
  );
  await page.route('**/api/v1/invitations', (route) =>
    route.fulfill(
      route.request().method() === 'GET'
        ? { json: [] }
        : {
            status: 503,
            json: { error: { code: 'MAIL_UNAVAILABLE', message: 'Synthetic mail unavailable' } },
          },
    ),
  );
  await login(page);
  await page.goto('/settings?tab=members');
  await page.getByLabel('Invite email', { exact: true }).waitFor();
  await page.getByLabel('Invite email', { exact: true }).evaluate((el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      el,
      'autofilled@example.test',
    );
  });
  await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
  await expect(page.getByText('Synthetic mail unavailable')).toBeVisible();
  await expect(page.getByLabel('Invite email', { exact: true })).toHaveValue(
    'autofilled@example.test',
  );
});
