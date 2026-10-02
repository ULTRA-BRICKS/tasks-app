import { test, expect, type Page, type BrowserContext } from '@playwright/test';
let cookies: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;
async function login(page: Page) {
  if (cookies) { await page.context().addCookies(cookies); await page.goto('/issues'); }
  else { await page.goto('/login'); await page.getByLabel('Email', { exact: true }).fill('demo@example.test'); await page.getByLabel('Password', { exact: true }).fill('local-demo-password'); await page.getByRole('button', { name: 'Continue', exact: true }).click(); cookies = await page.context().cookies(); }
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
}
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
test('Shift-click selects the visible inclusive range, reverse range works, Escape clears once', async ({ page }) => {
  await login(page); const rows = page.getByTestId('issue-row');
  await rows.nth(1).getByRole('checkbox').click();
  await rows.nth(5).getByRole('checkbox').click({ modifiers: ['Shift'] });
  await expect(page.locator('.issue-row input:checked')).toHaveCount(5);
  await page.keyboard.press('Escape');
  await expect(page.locator('.issue-row input:checked')).toHaveCount(0);
  await rows.nth(5).getByRole('checkbox').click();
  await rows.nth(2).locator('.issue-open').click({ modifiers: ['Shift'] });
  await expect(page).toHaveURL(/\/issues$/);
  await expect(page.locator('.issue-row input:checked')).toHaveCount(4);
});
test('Cmd+/ opens searchable shortcuts and Escape closes it and a clean issue even after a picker', async ({ page }) => {
  await login(page); await page.keyboard.press(mod + '+/');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true })).toHaveCount(0);
  await page.locator('.issue-open').first().click();
  await page.getByRole('combobox', { name: 'Status', exact: true }).click();
  await page.keyboard.press('Escape'); await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.locator('.issue-detail-toolbar').click({ position: { x: 185, y: 18 } });
  await page.keyboard.press('Escape'); await expect(page).toHaveURL(/\/issues$/);
});
test('saved title change can be undone and redone without intercepting ordinary text undo', async ({ page, browserName }) => {
  await login(page); await page.locator('.issue-open').first().click();
  const title = page.getByRole('textbox', { name: 'Title', exact: true }), before = await title.inputValue();
  await title.fill(before + ' revised ' + browserName); await title.press('Enter');
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
  await page.locator('.issue-detail-toolbar').click({ position: { x: 185, y: 18 } });
  await page.keyboard.press(mod + '+z'); await expect(title).toHaveValue(before);
  await page.keyboard.press(mod + '+Shift+z'); await expect(title).toHaveValue(before + ' revised ' + browserName);
});
test('copy menu exposes issue identifier, Markdown, branch name and prompt, not only link', async ({ page }) => {
  await login(page); await page.locator('.issue-open').first().click();
  await page.getByRole('button', { name: 'Copy issue', exact: true }).click();
  for (const name of ['Copy issue ID', 'Copy Markdown', 'Copy branch name', 'Copy prompt']) await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('menu')).toHaveCount(0);
});
