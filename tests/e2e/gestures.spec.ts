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
