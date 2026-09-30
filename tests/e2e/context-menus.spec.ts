import { test, expect } from '@playwright/test';
import { login, stubClipboard } from './session-fixture';

// Ported from the 18 September RED acceptance cases (tasks-context-menu-20260918, untracked), with
// current Task wording. Right-click, Shift+F10, hold and the visible ellipsis share one action list.

test('task right-click, Shift+F10 and the preview More menu list identical actions', async ({
  page,
}) => {
  await login(page);
  const row = page.getByTestId('issue-row').first();
  await row.click({ button: 'right' });
  const menu = page.getByRole('menu').first();
  await expect(menu).toBeVisible();
  const labels = await menu.getByRole('menuitem').allTextContents();
  expect(labels).toEqual(['Open task', 'Status', 'Assignee', 'Copy', 'Select task']);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  await page
    .getByRole('button', { name: /^Preview TKT-/ })
    .first()
    .click();
  const preview = page.getByRole('dialog', { name: 'Task preview', exact: true });
  const more = preview.getByRole('button', { name: 'More actions', exact: true });
  await more.click();
  await expect(page.getByRole('menu').first()).toBeVisible();
  expect(await page.getByRole('menu').first().getByRole('menuitem').allTextContents()).toEqual(
    labels,
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(more).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);

  const title = row.locator('.issue-open');
  await title.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu').first()).toBeVisible();
  expect(await page.getByRole('menu').first().getByRole('menuitem').allTextContents()).toEqual(
    labels,
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(title).toBeFocused();
  await expect(page).toHaveURL(/\/tasks$/);
});

test('team menu is reachable by ellipsis, right-click and Shift+F10 without navigating', async ({
  page,
}) => {
  await login(page);
  const row = page.locator('.team-context-row').first();
  await row.getByRole('button', { name: /^Actions for / }).click();
  await expect(page.getByRole('menuitem', { name: 'Open team tasks', exact: true })).toBeVisible();
  const visible = await page.getByRole('menu').first().getByRole('menuitem').allTextContents();
  await page.keyboard.press('Escape');
  // The closing popup stays mounted for its exit transition; open the next menu after it.
  await expect(page.getByRole('menu')).toHaveCount(0);
  await row.locator('.nav-item').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Open team tasks', exact: true })).toBeVisible();
  expect(await page.getByRole('menu').first().getByRole('menuitem').allTextContents()).toEqual(
    visible,
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await row.locator('.nav-item').focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Open team tasks', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(row.locator('.nav-item')).toBeFocused();
  await expect(page).toHaveURL(/\/tasks$/);
});

test('copy submenu provides identifiers and Markdown; selected text keeps the native menu', async ({
  page,
}) => {
  await login(page);
  const row = page.getByTestId('issue-row').first();
  await row.click({ button: 'right' });
  // Opened from the keyboard, as in overflow-actions: Escape then closes one level at a time.
  // (A submenu opened by hovering closes with its whole menu on Escape; that is Base UI's rule.)
  const copy = page.getByRole('menuitem', { name: 'Copy', exact: true });
  await copy.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitem', { name: 'Copy task ID', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Copy Markdown', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  const text = row.locator('.issue-open > span').last();
  await text.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await text.dispatchEvent('contextmenu', { bubbles: true });
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(await page.evaluate(() => window.getSelection()?.toString().length)).toBeGreaterThan(0);
});

test('pointer: the Copy submenu keeps the row menu open and a slow item click copies instead of holding the row', async ({
  page,
}) => {
  await login(page);
  await stubClipboard(page);
  const row = page.getByTestId('issue-row').first();
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).hover();
  const item = page.getByRole('menuitem', { name: 'Copy task ID', exact: true });
  await expect(item).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(2);
  const box = (await item.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // A row hold marks the row synchronously on pointerdown; the portalled menu item is not the row.
  expect(await row.locator('..').getAttribute('data-pressing')).toBeNull();
  await page.waitForTimeout(450); // Longer than the 340 ms hold threshold.
  await expect(page.getByRole('dialog', { name: 'Task preview', exact: true })).toHaveCount(0);
  await page.mouse.up();
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.dataset.copied)).toMatch(/^TKT-\d+$/);
});

test('document rows open their menu on right-click; a touch long-press keeps the link menu', async ({
  page,
}) => {
  await login(page);
  const result = await page.request.post('/api/v1/documents', {
    headers: { 'x-tickets-csrf': '1' },
    data: { title: 'Context-menu document', body: 'Preserved source text' },
  });
  expect(result.status()).toBe(201);
  await page.goto('/documents');
  const row = page
    .locator('.knowledge-context-row')
    .filter({ hasText: 'Context-menu document' })
    .first();
  await row.locator('.knowledge-row').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Open document', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Archive document', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/documents$/);
  // Android fires contextmenu for a touch long-press: the row is a link, so the browser keeps its
  // own link menu (open in new tab, copy link) and the row's ellipsis carries the actions on touch.
  const prevented = await row.locator('.knowledge-row').evaluate((link) => {
    const event = new PointerEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      pointerType: 'touch',
    });
    link.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('holding a team row opens its menu and the release does not navigate', async ({ page }) => {
  await login(page);
  const item = page.locator('.team-context-row').first().locator('.nav-item');
  const box = (await item.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.team-context-row').first()).toHaveAttribute('data-pressing', 'true');
  await expect(page.getByRole('menuitem', { name: 'Open team tasks', exact: true })).toBeVisible();
  await page.mouse.up();
  await expect(page.getByRole('menuitem', { name: 'Open team tasks', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/tasks$/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  // Android follows a touch hold with contextmenu: on a row the hold owns, the browser's menu is
  // cancelled and no second menu opens.
  const prevented = await item.evaluate((button) => {
    const event = new PointerEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      pointerType: 'touch',
    });
    button.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect(page.getByRole('menu')).toHaveCount(0);
});
