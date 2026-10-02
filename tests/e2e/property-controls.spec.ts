import { test, expect, type Locator, type Page } from '@playwright/test';
import { login } from './session-fixture';

// Acceptance for docs/PROPERTY-CONTROLS.md (UB-101).

async function openTask(page: Page) {
  await login(page);
  await page
    .getByTestId('issue-row')
    .first()
    .getByRole('button', { name: /^TKT-\d+ / })
    .click();
  await expect(page.getByRole('heading', { name: 'Properties' })).toBeVisible();
}

const rail = (page: Page) => page.getByRole('complementary', { name: 'Task properties' });

/** The property row that holds the control: icon and value live inside this one surface. */
const estimateRow = (page: Page) =>
  rail(page)
    .locator('.compact-property')
    .filter({ has: page.getByRole('combobox', { name: 'Estimate', exact: true }) });
const dueRow = (page: Page) =>
  rail(page)
    .locator('.compact-property')
    .filter({ has: page.getByRole('textbox', { name: 'Due date', exact: true }) });

/** Presses Tab from the top of the rail until the target holds focus, as a keyboard user would. */
async function tabTo(page: Page, target: Locator) {
  await rail(page).getByRole('combobox', { name: 'Status', exact: true }).focus();
  for (let step = 0; step < 20; step++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

/** Every paint property a state can change on the control surface, once its transition ended. */
const paint = (row: Locator) =>
  row.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => null)));
    const style = getComputedStyle(el);
    return {
      background: style.backgroundColor,
      border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
      radius: style.borderTopLeftRadius,
      shadow: style.boxShadow,
      outline: `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`,
    };
  });

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the date control paints hover, focus and open like another property control', async ({
    page,
  }) => {
    await openTask(page);
    const estimate = estimateRow(page);
    const due = dueRow(page);

    const rest = await paint(due);
    expect(await paint(estimate)).toEqual(rest);

    // Hover: both rows react, and identically.
    await due.hover();
    const hoveredDue = await paint(due);
    await estimate.hover();
    const hoveredEstimate = await paint(estimate);
    expect(hoveredDue).not.toEqual(rest);
    expect(hoveredDue).toEqual(hoveredEstimate);

    // Keyboard focus (focus-visible) lands on the control, not on the mouse.
    await page.mouse.move(0, 0);
    await tabTo(page, estimate.getByRole('combobox', { name: 'Estimate', exact: true }));
    const focusedEstimate = await paint(estimate);
    expect(focusedEstimate).not.toEqual(rest);
    await tabTo(page, due.getByRole('textbox', { name: 'Due date', exact: true }));
    expect(await paint(due)).toEqual(focusedEstimate);
  });

  test('an open date calendar and an open picker share the open state', async ({ page }) => {
    await openTask(page);
    const rest = await paint(dueRow(page));
    await page.mouse.move(0, 0);

    await estimateRow(page).getByRole('combobox', { name: 'Estimate', exact: true }).click();
    await expect(page.getByRole('listbox', { name: 'Estimate' })).toBeVisible();
    await page.mouse.move(0, 0);
    const openEstimate = await paint(estimateRow(page));
    expect(openEstimate).not.toEqual(rest);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox', { name: 'Estimate' })).toHaveCount(0);

    await dueRow(page).getByRole('button', { name: 'Open due date calendar' }).click();
    await expect(page.getByRole('dialog', { name: 'Due date calendar' })).toBeVisible();
    await page.mouse.move(0, 0);
    expect(await paint(dueRow(page))).toEqual(openEstimate);
  });

  test('the calendar icon sits inside the outline and hover surface of the date control', async ({
    page,
  }) => {
    await openTask(page);
    const due = dueRow(page);
    const inset = (row: Locator) =>
      row.evaluate(async (el) => {
        await Promise.all(
          el.getAnimations().map((animation) => animation.finished.catch(() => null)),
        );
        const box = el.getBoundingClientRect();
        const icon = el.querySelector('svg')!.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          left: icon.left - box.left,
          insideX: icon.left >= box.left && icon.right <= box.right,
          insideY: icon.top >= box.top && icon.bottom <= box.bottom,
          surface:
            parseFloat(style.borderTopWidth) > 0 &&
            (style.borderTopColor !== 'rgba(0, 0, 0, 0)' ||
              style.backgroundColor !== 'rgba(0, 0, 0, 0)'),
        };
      });
    // The reference: another property's icon, inside its own row.
    const reference = await inset(estimateRow(page));
    for (const state of ['rest', 'hover', 'focus', 'open']) {
      if (state === 'hover') await due.hover();
      if (state === 'focus') {
        await page.mouse.move(0, 0);
        await due.getByRole('textbox', { name: 'Due date', exact: true }).focus();
      }
      if (state === 'open') {
        await due.getByRole('button', { name: 'Open due date calendar' }).click();
        await expect(page.getByRole('dialog', { name: 'Due date calendar' })).toBeVisible();
      }
      const box = await inset(due);
      expect(box.insideX && box.insideY, state + ' ' + JSON.stringify(box)).toBe(true);
      // Same inset as the other icons, and the row paints a surface around it.
      // A 15px and a 16px glyph centre in the same 16px slot: allow the half pixel.
      expect(Math.abs(box.left - reference.left), state).toBeLessThanOrEqual(1);
      if (state !== 'rest') expect(box.surface, state).toBe(true);
    }
  });

  test('while a property write is pending every row is disabled: no hover paint, dimmed value', async ({
    page,
  }) => {
    await openTask(page);
    let release!: () => void;
    const held = new Promise<void>((done) => (release = done));
    await page.route(/\/api\/v1\/issues\/[^/?]+$/, async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      await held;
      return route.fallback();
    });
    const priority = rail(page).getByRole('combobox', { name: 'Priority', exact: true });
    const current = (await priority.innerText()).trim();
    await priority.click();
    await page.getByRole('option', { name: current === 'Urgent' ? 'High' : 'Urgent' }).click();
    const input = dueRow(page).getByRole('textbox', { name: 'Due date', exact: true });
    await expect(input).toBeDisabled();
    const rest = await paint(dueRow(page));
    await dueRow(page).hover({ force: true });
    expect(await paint(dueRow(page))).toEqual(rest);
    // The date value dims to the level a disabled picker has.
    const opacity = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).opacity);
    expect(await opacity(input)).toBe(await opacity(estimateRow(page).getByRole('combobox')));
    expect(await opacity(input)).not.toBe('1');
    release();
    await expect(input).toBeEnabled();
    // Put the task back for the tests after this one.
    await priority.click();
    await page.getByRole('option', { name: current, exact: true }).click();
    await expect(input).toBeEnabled();
  });

  test('the date icon and the pickers have the same cursor and the whole row is the click target', async ({
    page,
  }) => {
    await openTask(page);
    const cursor = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).cursor);
    const picker = estimateRow(page).getByRole('combobox', { name: 'Estimate', exact: true });
    const icon = dueRow(page).getByRole('button', { name: 'Open due date calendar' });
    expect(await cursor(icon)).toBe(await cursor(picker));
    // A press on the row's left edge, beside the icon, activates the control like its value does.
    const edge = async (row: Locator) => {
      const box = (await row.boundingBox())!;
      await page.mouse.click(box.x + 2, box.y + box.height / 2);
    };
    await edge(estimateRow(page));
    await expect(page.getByRole('listbox', { name: 'Estimate' })).toBeVisible();
    await page.keyboard.press('Escape');
    await edge(dueRow(page));
    await expect(page.getByRole('dialog', { name: 'Due date calendar' })).toBeVisible();
  });
});
