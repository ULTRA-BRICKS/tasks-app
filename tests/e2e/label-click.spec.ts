import { test, expect, type Page } from '@playwright/test';
import { login } from './session-fixture';

// Acceptance for docs/LABEL-CLICK.md (UB-99).

const chipOf = (page: Page, name?: string | RegExp) =>
  page
    .getByTestId('issue-row')
    .first()
    .getByRole('button', { name: name ?? /^Edit labels of TKT-\d+: / })
    .first();

async function expectLabelsFocused(page: Page) {
  const labels = page
    .getByRole('complementary', { name: 'Task properties' })
    .getByRole('combobox', { name: 'Labels', exact: true });
  await expect(labels).toBeFocused();
  // Focus only: the picker stays closed until the person asks for it.
  await expect(labels).toHaveAttribute('aria-expanded', 'false');
  // A pointer click must still leave a visible focus indicator.
  await expect(labels).toHaveCSS('outline-style', 'solid');
  await expect(page.getByRole('listbox', { name: 'Labels' })).toHaveCount(0);
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('clicking a label chip in a row opens the task and focuses Labels', async ({ page }) => {
    await login(page);
    const chip = chipOf(page);
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page).toHaveURL(/\/tasks\/[^/?]+/);
    await expect(page.getByRole('heading', { name: 'Properties' })).toBeVisible();
    await expectLabelsFocused(page);
  });

  test('a label chip is a sibling of the open button and works from the keyboard', async ({
    page,
  }) => {
    await login(page);
    const row = page.getByTestId('issue-row').first();
    // Never a button inside the open button (invalid nesting breaks row semantics).
    await expect(row.locator('.issue-open button, .issue-open .label-pill')).toHaveCount(0);
    const chip = chipOf(page);
    await chip.focus();
    await expect(chip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tasks\/[^/?]+/);
    await expectLabelsFocused(page);
  });

  test('the focus request is consumed: a reload does not move focus again', async ({ page }) => {
    await login(page);
    await chipOf(page).click();
    await expectLabelsFocused(page);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Properties' })).toBeVisible();
    await expect(
      page.getByRole('complementary', { name: 'Task properties' }).getByRole('combobox', {
        name: 'Labels',
        exact: true,
      }),
    ).not.toBeFocused();
  });

  test('a row click outside the chips still opens the task without moving focus to Labels', async ({
    page,
  }) => {
    await login(page);
    await page
      .getByTestId('issue-row')
      .first()
      .getByRole('button', { name: /^TKT-\d+ / })
      .click();
    await expect(page.getByRole('heading', { name: 'Properties' })).toBeVisible();
    await expect(
      page.getByRole('complementary', { name: 'Task properties' }).getByRole('combobox', {
        name: 'Labels',
        exact: true,
      }),
    ).not.toBeFocused();
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('tapping a label in the preview opens the task and focuses Labels', async ({ page }) => {
    await login(page);
    await page
      .getByRole('button', { name: /^Preview TKT-/ })
      .first()
      .tap();
    const preview = page.getByRole('dialog', { name: 'Task preview', exact: true });
    await expect(preview).toBeVisible();
    await preview
      .getByRole('button', { name: /^Edit labels of TKT-\d+: / })
      .first()
      .tap();
    await expect(page).toHaveURL(/\/tasks\/[^/?]+/);
    await expect(preview).toHaveCount(0);
    await expectLabelsFocused(page);
  });
});
