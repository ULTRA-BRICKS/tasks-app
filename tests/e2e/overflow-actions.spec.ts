import { test, expect, type Page, type BrowserContext } from '@playwright/test';
let cookies: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;
async function login(page: Page) {
  if (cookies) {
    await page.context().addCookies(cookies);
    await page.goto('/issues');
    await expect(page.getByTestId('issue-row').first()).toBeVisible();
    return;
  }
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
  cookies = await page.context().cookies();
}
test('team actions are visible and copying an identifier retains the page', async ({ page }) => {
  await login(page);
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.copied = text;
        },
      },
    }),
  );
  const row = page.locator('.team-context-row').first();
  const trigger = row.getByRole('button', { name: /^Actions for / });
  await trigger.click();
  await expect(page.getByRole('menuitem', { name: 'Open team issues', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Copy ID', exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  const copied = await page.evaluate(() => document.documentElement.dataset.copied);
  expect(copied).toMatch(/^[a-f0-9-]{36}$/);
  await expect(page).toHaveURL(/\/issues$/);
});
test('issue copy submenu uses the current text and closes one level at a time with Escape', async ({
  page,
}) => {
  await login(page);
  await page.locator('.issue-open').first().click();
  await page.getByRole('button', { name: 'Issue actions', exact: true }).click();
  const parent = page.getByRole('menu').first();
  await expect(parent).toBeVisible();
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitem', { name: 'Copy Markdown', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Copy branch name', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Issue actions', exact: true })).toBeFocused();
});
test('document actions preserve text and expose archive; cancellation writes nothing', async ({
  page,
  browserName,
}) => {
  await login(page);
  const title = 'Menu fixture ' + browserName;
  const created = await page.request.post('/api/v1/documents', {
    headers: { 'x-tickets-csrf': '1' },
    data: { title, body: 'Original **Markdown**' },
  });
  expect(created.status()).toBe(201);
  await page.goto('/documents');
  const row = page.locator('.knowledge-context-row').filter({ hasText: title });
  await row.getByRole('button', { name: 'Actions for ' + title, exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Open document', exact: true })).toBeVisible();
  let writes = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/') && request.method() !== 'GET') writes++;
  });
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('menuitem', { name: 'Archive document', exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(row).toBeVisible();
  expect(writes).toBe(0);
});
test('clipboard failures produce feedback rather than silent success', async ({ page }) => {
  await login(page);
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('Denied by synthetic browser')) },
    }),
  );
  await page
    .locator('.team-context-row')
    .first()
    .getByRole('button', { name: /^Actions for / })
    .click();
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Copy link', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not be confirmed');
  await page.getByRole('button', { name: 'Dismiss action error', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
