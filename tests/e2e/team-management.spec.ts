import { test, expect, type Page, type BrowserContext } from '@playwright/test';
let cookies: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;
async function login(page: Page) {
  if (cookies) {
    await page.context().addCookies(cookies);
    await page.goto('/issues');
  } else {
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
    await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
  cookies = await page.context().cookies();
}
test('team menu exposes safe removal, requires typed key, and keeps existing work', async ({
  page,
  browserName,
}) => {
  await login(page);
  const key = browserName === 'webkit' ? 'QAW' : 'QAC';
  const r = await page.request.post('/api/v1/teams', {
    headers: { 'x-tickets-csrf': '1' },
    data: { key, name: 'Temporary empty team ' + key },
  });
  expect(r.status()).toBe(201);
  const team = await r.json();
  await page.reload();
  const row = page.locator('.team-context-row').filter({ hasText: team.name });
  await row.getByRole('button', { name: 'Actions for ' + team.name, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete team', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete team', exact: true });
  await expect(dialog.getByRole('button', { name: 'Delete team', exact: true })).toBeDisabled();
  await dialog.getByLabel('Type ' + key + ' to confirm').fill(key);
  await dialog.getByRole('button', { name: 'Delete team', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toHaveCount(0);
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
  expect((await page.request.get('/api/v1/teams/' + team.id)).status()).toBe(404);
});
test('nonempty team removal explains dependencies and cancellation sends no delete request', async ({
  page,
}) => {
  await login(page);
  let deletions = 0;
  page.on('request', (request) => {
    if (request.method() === 'DELETE') deletions++;
  });
  await page
    .locator('.team-context-row')
    .first()
    .getByRole('button', { name: /Actions for / })
    .click();
  await page.getByRole('menuitem', { name: 'Delete team', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete team', exact: true });
  await expect(dialog.getByRole('button', { name: 'Delete team', exact: true })).toBeDisabled();
  await expect(dialog.getByText(/Keep at least one|Move the linked work first/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(deletions).toBe(0);
});
