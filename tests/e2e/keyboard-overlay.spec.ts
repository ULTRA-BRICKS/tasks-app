import { test, expect } from '@playwright/test';
test('closed retained popup nodes do not disable workspace keyboard commands', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByLabel('Password', { exact: true }).press('Enter');
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
  await page.evaluate(() => {
    const popup = document.createElement('div');
    popup.role = 'listbox';
    popup.hidden = true;
    popup.id = 'synthetic-retained-popup';
    document.body.append(popup);
    (document.activeElement as HTMLElement)?.blur();
  });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await expect(page.getByRole('dialog', { name: 'Command menu', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('c');
  await expect(page).toHaveURL(/\/issues\/new$/);
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await title.fill('Typing must remain typing');
  await title.press('c');
  await expect(title).toHaveValue('Typing must remain typingc');
});
