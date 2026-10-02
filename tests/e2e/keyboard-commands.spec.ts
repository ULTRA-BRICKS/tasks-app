/**
 * UB-36 phase B: one command registry drives dispatch, help, the palette and context menus,
 * with platform keycaps, permissions, input guards and Escape layering (docs/KEYBOARD-COMMANDS.md).
 */
import { test, expect } from '@playwright/test';
import {
  modifier,
  usePlatform,
  requests,
  rows,
  selectedCount,
  blur,
  helpRow,
  openWorkspace,
} from './keyboard-fixture';
import { login } from './session-fixture';

for (const platform of ['mac', 'windows'] as const) {
  test.describe(`on ${platform}`, () => {
    test.beforeEach(async ({ page }) => {
      await usePlatform(page, platform);
      await login(page);
    });

    test('help: the shortcut sheet is generated from the registry with platform keycaps', async ({
      page,
    }) => {
      const row = rows(page).first().locator('.issue-open');
      await row.focus();
      await page.keyboard.press(`${modifier(platform)}+/`);
      const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
      await expect(help).toBeVisible();
      const palette = helpRow(page, 'Open command menu');
      await expect(palette.locator('.keycaps-visual')).toHaveText(
        platform === 'mac' ? '⌘K' : 'CtrlK',
      );
      await expect(palette.locator('.sr-only')).toHaveText(
        platform === 'mac' ? 'Command K' : 'Control K',
      );
      await expect(helpRow(page, 'Undo last saved change').locator('.sr-only')).toHaveText(
        platform === 'mac' ? 'Command Z' : 'Control Z',
      );
      await expect(helpRow(page, 'Redo').locator('.sr-only')).toHaveText(
        platform === 'mac' ? ['Shift Command Z'] : ['Control Y', 'Control Shift Z'],
      );
      // The focused-row keys from the task preview are part of the same registry.
      await expect(helpRow(page, 'Peek into the focused task').locator('.sr-only')).toHaveText(
        'Space',
      );
      await expect(helpRow(page, 'Actions for the focused item').locator('.sr-only')).toHaveText(
        'Shift F10',
      );
      await expect(helpRow(page, 'Go to settings').locator('.sr-only')).toHaveText('G then S');
      await page.keyboard.press('Escape');
      await expect(help).toHaveCount(0);
      await expect(row).toBeFocused();
    });

    test('platform: only this platform’s modifier opens the palette', async ({ page }) => {
      const other = platform === 'mac' ? 'Control' : 'Meta';
      await page.keyboard.press(`${other}+k`);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.keyboard.press(`${modifier(platform)}+k`);
      await expect(
        page.getByRole('combobox', { name: 'Search commands and tasks', exact: true }),
      ).toBeFocused();
    });

    test('palette: registry commands with keycaps run the same handler as their keys', async ({
      page,
    }) => {
      await page.keyboard.press(`${modifier(platform)}+k`);
      const menu = page.getByRole('dialog', { name: 'Command menu' });
      const help = menu.getByRole('option', { name: /Show keyboard shortcuts/ });
      await expect(help).toBeVisible();
      await expect(help.locator('.sr-only')).toHaveText(
        platform === 'mac'
          ? ['Command Slash', 'Question mark']
          : ['Control Slash', 'Question mark'],
      );
      await menu.getByRole('combobox').fill('settings');
      const settings = menu.getByRole('option', { name: /Go to settings/ });
      await expect(settings).toHaveAttribute('aria-selected', 'true');
      await expect(settings.locator('.sr-only')).toHaveText('G then S');
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/settings$/);
      await expect(menu).toHaveCount(0);
    });
  });
}

test.describe('in the workspace', () => {
  let mod: 'Meta' | 'Control';
  test.beforeEach(async ({ page }) => {
    mod = await openWorkspace(page);
  });

  test('permissions: viewers see edit commands disabled and their keys do nothing', async ({
    page,
  }) => {
    await page.route('**/api/v1/me', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: { ...(await response.json()), role: 'viewer', scopes: ['read'] },
      });
    });
    await page.reload();
    await expect(rows(page).first()).toBeVisible();
    const writes = requests(page, 'PATCH', /^\/api\/v1\/issues/);
    await page.keyboard.press(`${mod}+k`);
    const menu = page.getByRole('dialog', { name: 'Command menu' });
    await expect(menu.getByRole('option', { name: /Create task/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(menu.getByRole('option', { name: /Undo last saved change/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await menu.getByRole('combobox').fill('create task');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tasks$/);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await page.keyboard.press('j');
    await page.keyboard.press('x');
    await page.keyboard.press('Shift+J');
    await expect(selectedCount(page)).toHaveCount(0);
    await page.keyboard.press('c');
    await page.keyboard.press(`${mod}+z`);
    await expect(page).toHaveURL(/\/tasks$/);
    expect(writes).toHaveLength(0);
  });

  test('guards: IME composition, text entry and open surfaces never run commands', async ({
    page,
  }) => {
    await page.evaluate(() => {
      for (const init of [
        { key: 'c', code: 'KeyC', isComposing: true },
        { key: 'Process', code: 'KeyC', keyCode: 229 },
      ])
        document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    });
    // Typing in a field is text, not commands: G P would open projects, C a new task, ? help.
    // The search box writes its text to ?q=, so only the path tells whether a command ran.
    const search = page.getByLabel('Search tasks', { exact: true });
    await search.focus();
    await page.keyboard.type('gpc?');
    expect(new URL(page.url()).pathname).toBe('/tasks');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await blur(page);
    // A menu is a surface: it owns the keys while open.
    await page.getByRole('button', { name: 'Task actions', exact: true }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('c');
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/tasks');
  });

  test('escape: a focused closed picker keeps Escape for itself', async ({ page }) => {
    await rows(page).first().locator('.issue-open').focus();
    await page.keyboard.press('x');
    await expect(selectedCount(page)).toHaveText('1 selected');
    const picker = page.getByRole('combobox', { name: 'Bulk change status' });
    await picker.focus();
    await page.keyboard.press('Escape');
    await expect(selectedCount(page)).toHaveText('1 selected');
    await expect(picker).toBeFocused();
  });

  test('escape: one layer per press, hidden retained popups ignored, focus and drafts kept', async ({
    page,
  }) => {
    const first = rows(page).first().locator('.issue-open');
    await first.focus();
    await page.keyboard.press('x');
    await expect(selectedCount(page)).toHaveText('1 selected');
    // Retained popups that are closed must not swallow Escape.
    await page.evaluate(() => {
      const hidden = document.createElement('div');
      hidden.setAttribute('role', 'menu');
      hidden.hidden = true;
      const collapsed = document.createElement('div');
      collapsed.setAttribute('role', 'listbox');
      collapsed.style.display = 'none';
      const closing = document.createElement('dialog');
      closing.open = true;
      closing.inert = true;
      closing.setAttribute('data-state', 'closing');
      document.body.append(hidden, collapsed, closing);
    });
    // Topmost surface first: the preview closes, the selection stays.
    await page.keyboard.press('Space');
    const preview = page.getByRole('dialog', { name: 'Task preview' });
    await expect(preview).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(preview).toHaveCount(0);
    await expect(first).toBeFocused();
    await expect(selectedCount(page)).toHaveText('1 selected');
    // Then the selection.
    await page.keyboard.press('Escape');
    await expect(selectedCount(page)).toHaveCount(0);
    await expect(first).toBeFocused();
    await expect(page).toHaveURL(/\/tasks$/);

    // A new-task draft survives the Escape that returns to the list.
    await page.getByRole('button', { name: 'New task', exact: true }).click();
    await expect(page).toHaveURL(/\/tasks\/new$/);
    const title = page.getByRole('textbox', { name: 'Title', exact: true });
    await title.fill('Escape keeps this draft');
    await blur(page);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/tasks$/);
    await page.getByRole('button', { name: 'New task', exact: true }).click();
    await expect(title).toHaveValue('Escape keeps this draft');
  });
});
