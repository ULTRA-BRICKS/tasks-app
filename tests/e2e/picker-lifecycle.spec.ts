import { test, expect } from '@playwright/test';

test('selecting an issue status hides and deactivates its popup and restores trigger focus', async ({
  page,
}) => {
  await page.goto('/issues');
  await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
  await page.goto('/issues/new');
  const trigger = page.getByRole('combobox', { name: 'Status', exact: true });
  await trigger.click();
  const list = page.getByRole('listbox', { name: 'Status' });
  await expect(list).toBeVisible();
  await list.getByRole('option').nth(1).click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.locator('.picker-popup').locator('..')).toHaveAttribute('hidden', '');
  await expect(page.locator('.picker-popup')).toBeHidden();
  // Once hidden, Base UI can remove transient inert. Hidden options must still reject focus.
  await page
    .locator('.picker-popup [role="option"]')
    .first()
    .evaluate((node: HTMLElement) => node.focus());
  await expect(trigger).toBeFocused();
  await expect(page.locator('[data-base-ui-focus-guard]')).toHaveCount(0);
});
