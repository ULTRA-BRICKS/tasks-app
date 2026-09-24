import { expect, type Page, type BrowserContext } from '@playwright/test';
let session: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;
/** Reuse the synthetic fixture's login, without disabling the real authentication rate limiter. */
export async function login(page: Page) {
  if (session) {
    await page.context().addCookies(session);
    const me = await page.request.get('/api/v1/me');
    if (me.ok()) {
      await page.goto('/issues');
      await expect(page.getByTestId('issue-row').first()).toBeVisible();
      return;
    }
    session = undefined;
    await page.context().clearCookies();
  }
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
  session = await page.context().cookies();
}
