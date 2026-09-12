import { test, expect } from '@playwright/test';

let cookies: Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>> | undefined;
test.beforeEach(async ({ page }) => {
  if (cookies) {
    await page.context().addCookies(cookies);
    await page.goto('/issues');
    await expect(page.getByTestId('issue-row').first()).toBeVisible();
    return;
  }
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
  cookies = await page.context().cookies();
});

test('mobile dock navigates and creates a document without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const dock = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(dock).toBeVisible();
  await dock.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await dock.getByRole('link', { name: 'Issues', exact: true }).click();
  await page.getByRole('button', { name: 'Create new issue', exact: true }).click();
  await expect(page).toHaveURL(/\/issues\/new/);
  await expect(page.getByLabel('Title', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('press slide release opens exactly the highlighted issue', async ({ page }) => {
  const row = page.getByTestId('issue-row').first();
  const trigger = row.locator('..').getByRole('button', { name: /^Preview / });
  const box = (await trigger.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const peek = page.getByRole('dialog', { name: 'Issue preview' });
  await expect(peek).toBeVisible();
  const open = await peek.getByRole('button', { name: 'Open issue', exact: true }).boundingBox();
  await page.mouse.move(open!.x + 20, open!.y + open!.height / 2);
  await page.mouse.up();
  await expect(page).toHaveURL(/\/issues\/[^/?]+/);
  await expect(peek).toHaveCount(0);
});

test('preview supports keyboard dismissal and restores focus', async ({ page }) => {
  const trigger = page.getByRole('button', { name: /^Preview / }).first();
  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'Issue preview' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Issue preview' })).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('moving before the hold threshold cancels preview', async ({ page }) => {
  const trigger = page.getByRole('button', { name: /^Preview / }).first();
  const box = (await trigger.boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x - 80, box.y + 80);
  await page.waitForTimeout(450);
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: 'Issue preview' })).toHaveCount(0);
  await expect(page).toHaveURL(/\/issues$/);
});

test('issue text selection is not swallowed by navigation or long press', async ({ page }) => {
  const title = page.getByTestId('issue-row').first().locator('.issue-open span').last();
  await title.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  const selected = await page.evaluate(() => getSelection()?.toString());
  expect(selected?.length).toBeGreaterThan(0);
  await title.dispatchEvent('click');
  await expect(page).toHaveURL(/\/issues$/);
  expect(await title.evaluate((node) => getComputedStyle(node).userSelect)).toBe('text');
});

test('canceling a touch pointer dismisses the peek without navigating', async ({ page }) => {
  const trigger = page.getByRole('button', { name: /^Preview / }).first();
  await trigger.evaluate((node) => {
    node.setPointerCapture = () => {};
  });
  await trigger.dispatchEvent('pointerdown', {
    pointerId: 71,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: 30,
    clientY: 150,
  });
  await expect(page.getByRole('dialog', { name: 'Issue preview' })).toBeVisible();
  await trigger.dispatchEvent('pointercancel', {
    pointerId: 71,
    pointerType: 'touch',
    isPrimary: true,
  });
  await expect(page.getByRole('dialog', { name: 'Issue preview' })).toHaveCount(0);
  await expect(page).toHaveURL(/\/issues$/);
});

test('project peek opens a real project and a grouped mobile list', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('link', { name: 'Projects', exact: true })
    .click();
  await expect(page.locator('.project-group').first()).toBeVisible();
  await page
    .getByRole('button', { name: /^Preview / })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Project preview' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Open project', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expect(page.getByLabel('Title', { exact: true })).toBeVisible();
});

test('holding card whitespace opens a peek rather than navigating', async ({ page }) => {
  await page.getByRole('button', { name: 'Board view', exact: true }).click();
  const card = page.locator('.issue-card').first();
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width - 18, box.y + box.height - 6);
  await page.mouse.down();
  const peek = page.getByRole('dialog', { name: 'Issue preview' });
  await expect(peek).toBeVisible();
  await page.mouse.up();
  await expect(peek).toBeVisible();
  await expect(page).toHaveURL(/\/issues$/);
  await page.keyboard.press('Escape');
});

test('click-open preview closes when its source list scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 600 });
  await page
    .getByRole('button', { name: /^Preview / })
    .first()
    .click();
  const preview = page.getByRole('dialog', { name: 'Issue preview' });
  await expect(preview).toBeVisible();
  await page.locator('.issues-content').evaluate((element) => {
    element.scrollTop += 160;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(preview).toHaveCount(0);
});

test('mobile team navigation closes its sheet instead of covering the destination', async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.getByRole('button', { name: 'More navigation', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Navigation', exact: true });
  await sheet.getByRole('button', { name: 'T Engineering', exact: true }).click();
  await expect(page).toHaveURL(/team_id=/);
  await expect(sheet).toBeHidden();
});

test('title grows after a viewport resize without requiring another edit', async ({ page }) => {
  await page.getByRole('button', { name: 'New issue', exact: true }).click();
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await title.fill(
    'A long title that wraps when the same issue document switches from a wide desktop canvas to a narrow phone viewport and must remain completely visible.',
  );
  await page.setViewportSize({ width: 320, height: 740 });
  await expect
    .poll(() => title.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeLessThanOrEqual(2);
});

test('mobile capsule menu supports filters and keyboard dismissal without firing workspace shortcuts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const trigger = page.getByRole('button', { name: 'Issue actions', exact: true });
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Issue actions', exact: true });
  await expect(menu).toBeVisible();
  await page.keyboard.press('c');
  await expect(page).toHaveURL(/\/issues$/);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Show filters', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Filter by team', exact: true })).toBeVisible();
});

test('mobile capsule and preview actions have at least 44px hit areas', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  for (const element of [
    page.getByRole('button', { name: 'New issue', exact: true }),
    page.getByRole('button', { name: 'Issue actions', exact: true }),
    page.getByRole('button', { name: /^Preview / }).first(),
  ]) {
    const box = (await element.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('only one issue preview is open and its own content can scroll', async ({ page }) => {
  const triggers = page.getByRole('button', { name: /^Preview / });
  await triggers.first().click();
  await triggers.nth(1).click();
  const dialog = page.getByRole('dialog', { name: 'Issue preview' });
  await expect(dialog).toHaveCount(1);
  await dialog
    .locator('.peek-content')
    .evaluate((element) => element.dispatchEvent(new Event('scroll')));
  await expect(dialog).toBeVisible();
});

test('native preview dialog blocks workspace commands until dismissed', async ({ page }) => {
  await page
    .getByRole('button', { name: /^Preview / })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Issue preview' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('c');
  await page.keyboard.press('Control+k');
  await expect(page).toHaveURL(/\/issues$/);
  await expect(dialog).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('typing retains one title resize observation for the mounted editor', async ({ page }) => {
  await page.evaluate(() => {
    const NativeObserver = window.ResizeObserver;
    Object.assign(window, { titleObservations: 0 });
    window.ResizeObserver = class extends NativeObserver {
      observe(target: Element, options?: ResizeObserverOptions) {
        if (target.matches('.document-title')) {
          const counts = window as typeof window & { titleObservations: number };
          counts.titleObservations++;
        }
        return super.observe(target, options);
      }
    };
  });
  await page.getByRole('button', { name: 'New issue', exact: true }).click();
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await expect(title).toBeVisible();
  const count = () =>
    page.evaluate(
      () => (window as typeof window & { titleObservations: number }).titleObservations,
    );
  const before = await count();
  expect(before).toBeGreaterThan(0);
  await title.pressSequentially('Keep one observer while typing this sentence');
  expect(await count()).toBe(before);
  await page.setViewportSize({ width: 320, height: 700 });
  await expect
    .poll(() => title.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeLessThanOrEqual(2);
  expect(await count()).toBe(before);
});

test('mobile document create and property actions remain touch-sized', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.getByRole('button', { name: 'New issue', exact: true }).click();
  for (const action of [
    page.getByRole('button', { name: 'Create issue', exact: true }),
    page.getByRole('combobox', { name: 'Status', exact: true }),
  ]) {
    const box = (await action.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    // A short server-provided label must not shrink the actionable area.
    expect(
      await action.evaluate((element) => parseFloat(getComputedStyle(element).minWidth)),
    ).toBeGreaterThanOrEqual(44);
  }
});
