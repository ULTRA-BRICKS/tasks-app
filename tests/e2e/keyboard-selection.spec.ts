/** UB-36 B4: range selection on the task list (docs/KEYBOARD-COMMANDS.md). */
import { test, expect } from '@playwright/test';
import { requests, rows, selectedCount, selectedFlags, openWorkspace } from './keyboard-fixture';

test.describe('in the workspace', () => {
  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
  });

  test('selection: Shift-click and Shift+J/K select inclusive visible ranges', async ({ page }) => {
    const writes = requests(page, 'PATCH', /^\/api\/v1\/issues/);
    const openers = rows(page).locator('.issue-open');
    await expect(openers.nth(5)).toBeVisible();
    await rows(page).nth(1).locator('.issue-checkbox').click();
    await openers.nth(4).click({ modifiers: ['Shift'] });
    await expect(page).toHaveURL(/\/tasks$/);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
    expect((await selectedFlags(page)).slice(0, 6)).toEqual([false, true, true, true, true, false]);
    // Re-extending from the same anchor shrinks the range, and reverse ranges work.
    await rows(page)
      .nth(0)
      .locator('.issue-checkbox')
      .click({ modifiers: ['Shift'] });
    expect((await selectedFlags(page)).slice(0, 6)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    await expect(selectedCount(page)).toHaveText('2 selected');

    // Keyboard: X picks the focused row, Shift+J extends from it, Shift+K shrinks back.
    await page.keyboard.press('Escape');
    await expect(selectedCount(page)).toHaveCount(0);
    await openers.nth(2).focus();
    await page.keyboard.press('x');
    await page.keyboard.press('Shift+J');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(openers.nth(4)).toBeFocused();
    expect((await selectedFlags(page)).slice(0, 6)).toEqual([
      false,
      false,
      true,
      true,
      true,
      false,
    ]);
    await page.keyboard.press('Shift+K');
    expect((await selectedFlags(page)).slice(0, 6)).toEqual([
      false,
      false,
      true,
      true,
      false,
      false,
    ]);
    await page.keyboard.press('Escape');

    // Collapsed groups are hidden, so a range across them skips their rows.
    const headings = page.locator('.issue-group .group-heading > button[aria-expanded]');
    expect(await headings.count()).toBeGreaterThanOrEqual(3);
    const middle = page.locator('.issue-group').nth(1);
    const hiddenCount = await middle.locator('[data-testid="issue-row"]').count();
    await headings.nth(1).click();
    await expect(middle.locator('[data-testid="issue-row"]')).toHaveCount(0);
    const firstGroup = page.locator('.issue-group').nth(0).locator('.issue-open');
    const thirdGroup = page.locator('.issue-group').nth(2).locator('.issue-open');
    await firstGroup.last().click({ modifiers: ['Shift'] });
    await thirdGroup.first().click({ modifiers: ['Shift'] });
    await expect(selectedCount(page)).toHaveText('2 selected');
    await headings.nth(1).click();
    await expect(middle.locator('[data-testid="issue-row"]')).toHaveCount(hiddenCount);
    await expect(middle.locator('.issue-checkbox:checked')).toHaveCount(0);

    // Plain text selection inside a row still works and does not open the task.
    await page.keyboard.press('Escape');
    const key = rows(page).first().locator('.issue-key');
    const box = (await key.boundingBox())!;
    await page.mouse.move(box.x + 1, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).not.toBe('');
    await expect(page).toHaveURL(/\/tasks$/);

    // Row text stays selected for copying, but Shift+J still extends the range.
    await page.keyboard.press('Escape');
    await openers.nth(2).focus();
    await page.keyboard.press('x');
    await key.evaluate((element) => window.getSelection()?.selectAllChildren(element));
    await page.keyboard.press('Shift+J');
    expect((await selectedFlags(page)).slice(0, 5)).toEqual([false, false, true, true, false]);
    expect(writes).toHaveLength(0);
  });
});
