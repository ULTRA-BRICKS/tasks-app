/** UB-36 B6: remapping in Settings → Keyboard (docs/KEYBOARD-COMMANDS.md). */
import { test, expect } from '@playwright/test';
import { blur, helpRow, openWorkspace } from './keyboard-fixture';

test.describe('in the workspace', () => {
  let mod: 'Meta' | 'Control';
  test.beforeEach(async ({ page }) => {
    mod = await openWorkspace(page);
  });

  test('remap: Settings → Keyboard records, refuses taken keys and persists', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Keyboard', exact: true }).click();
    await expect(page).toHaveURL(/tab=keyboard/);
    const change = page.getByRole('button', { name: 'Change shortcut for Go to inbox' });
    await change.click();
    // The recording owns the key: C is refused as taken and never creates a task.
    await page.keyboard.press('c');
    await expect(page.getByRole('alert')).toContainText('already used by “Create task”');
    await expect(page).toHaveURL(/\/settings/);
    await page.keyboard.press(`${mod}+a`);
    await expect(page.getByRole('alert')).toContainText('is reserved');
    await page.keyboard.press('Shift+I');
    await expect(page.locator('.shortcut-status')).toContainText('Go to inbox: Shift I.');
    await page.reload();
    await expect(
      page
        .locator('.shortcut-row')
        .filter({ hasText: 'Go to inbox' })
        .locator('.shortcut-keys .sr-only'),
    ).toHaveText('Shift I');
    await blur(page);
    await page.keyboard.press('?');
    await expect(helpRow(page, 'Go to inbox').locator('.sr-only')).toHaveText('Shift I');
    await page.keyboard.press('Escape');
    await page.keyboard.press('g');
    await page.keyboard.press('n');
    await expect(page).toHaveURL(/\/settings/);
    await page.keyboard.press('Shift+I');
    await expect(page).toHaveURL(/\/inbox$/);
  });
});
