import { test, expect, type Page } from '@playwright/test';
import { login } from './session-fixture';
import { expectOneLine, lineTexts } from './activity-lines';

async function saved(page: Page) {
  await expect(page.getByText('Saving…', { exact: true })).toHaveCount(0);
}
async function createTask(page: Page, title: string, description: string) {
  const headers = { Origin: new URL(page.url()).origin, 'x-tickets-csrf': '1' };
  const catalog = await (await page.request.get('/api/v1/catalog')).json();
  const created = await page.request.post('/api/v1/issues', {
    headers,
    data: { team_id: catalog.teams[0].id, title, description },
  });
  expect(created.status()).toBe(201);
  const task = await created.json();
  const status: string = catalog.statuses.find(
    (candidate: { id: string; name: string }) => candidate.id === task.status_id,
  ).name;
  return { task, status };
}
async function noPageOverflow(page: Page, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );
}
const activityEntries = (page: Page) =>
  page.locator('.activity-section').getByTestId('activity-entry');

// UB-100: «надо однострочно как раньше» — one status change is one line, not a heading plus a row.
test('a single field change is one activity line on desktop and wraps without overflow on a phone', async ({
  page,
  browserName,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const { task, status } = await createTask(page, `One line ${browserName} ${Date.now()}`, '');
  await page.goto('/tasks/' + task.id);
  await page.getByRole('combobox', { name: 'Status', exact: true }).click();
  await page.getByRole('option', { name: 'Done', exact: true }).click();
  await saved(page);

  const entry = activityEntries(page).last();
  await expect(entry).toContainText('Done');
  expect(await lineTexts(entry)).toEqual([`Alex Morgan changed Status ${status} → Done`]);
  await expect(entry).not.toContainText('updated the task');
  // Actor, field, both values and the time share one line box; the entry is one line tall.
  await expectOneLine(entry.getByTestId('activity-line'));
  const [entryBox, lineHeight] = await entry.evaluate((element) => [
    element.getBoundingClientRect().height,
    Number.parseFloat(
      getComputedStyle(element.querySelector('[data-testid="activity-line"]')!).lineHeight,
    ),
  ]);
  // One line plus the entry's vertical padding, never a second row.
  expect(entryBox).toBeLessThan(lineHeight * 2);
  await entry.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath(`single-${browserName}-1440.png`) });

  for (const [width, height] of [
    [390, 844],
    [320, 700],
  ]) {
    await page.waitForLoadState('networkidle');
    await page.setViewportSize({ width, height });
    await page.reload();
    const phoneEntry = activityEntries(page).last();
    await expect(phoneEntry).toContainText('Done');
    await expect(page.locator('.document-description[aria-busy="true"]')).toHaveCount(0);
    await phoneEntry.scrollIntoViewIfNeeded();
    await noPageOverflow(page, width);
    const box = await phoneEntry.boundingBox();
    expect(box && box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`single-${browserName}-${width}.png`) });
  }
  expect(errors).toEqual([]);
});

test('grouped edits read one line per change and the description diff expands with the keyboard', async ({
  page,
  browserName,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const paragraphs = ['One', 'Two', 'Three', 'Keep this line'];
  const { task, status } = await createTask(
    page,
    `Activity changes ${browserName} ${Date.now()}`,
    ['Ship on Monday', ...paragraphs].join('\n\n'),
  );
  await page.goto('/tasks/' + task.id);

  await page.getByRole('combobox', { name: 'Status', exact: true }).click();
  await page.getByRole('option', { name: 'Done', exact: true }).click();
  await saved(page);
  await page.getByRole('combobox', { name: 'Assignee', exact: true }).click();
  await page.getByRole('option', { name: 'Alex Morgan', exact: true }).click();
  await saved(page);
  const editor = page.getByRole('textbox', { name: 'Description', exact: true });
  await editor.fill('');
  await editor.pressSequentially('Ship on Friday');
  for (const paragraph of paragraphs) {
    await editor.press('Enter');
    await editor.pressSequentially(paragraph);
  }
  await page.getByLabel('Title', { exact: true }).click();
  await saved(page);
  await expect
    .poll(
      async () => (await (await page.request.get('/api/v1/issues/' + task.id)).json()).description,
    )
    .toMatch(/Ship on Friday[\s\S]*Three[\s\S]*Keep this line/);

  const activity = page.locator('.activity-section');
  // Three edits by one person within minutes read as one entry: one line per change, no heading.
  const entry = activityEntries(page).last();
  await expect(entry.getByTestId('activity-line')).toHaveCount(3);
  expect(await lineTexts(entry)).toEqual([
    `Alex Morgan changed Status ${status} → Done`,
    'changed Assignee Unassigned → Alex Morgan',
    'edited the description View changes',
  ]);
  await expect(activity).not.toContainText('updated the task');
  await expect(activity).not.toContainText(/\bissues?\b/i);
  await expect(activity).not.toContainText(task.status_id);
  for (const line of await entry.getByTestId('activity-line').all()) await expectOneLine(line);
  // The new assignee shows their avatar beside the name.
  await expect(
    entry.getByTestId('activity-line').nth(1).locator('.activity-to .avatar'),
  ).toBeVisible();
  await entry.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath(`grouped-${browserName}-1440.png`) });

  // The disclosure renames itself (View/Hide changes), so find it by either name.
  const toggle = entry.getByRole('button', { name: /^(View|Hide) changes$/ });
  await expect(toggle).toHaveAccessibleName('View changes');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveAccessibleName('Hide changes');
  const diff = entry.locator('.activity-diff');
  await expect(diff).toBeVisible();
  await expect(diff).toContainText('1 line removed, 1 line added');
  await expect(diff.locator('.diff-removed')).toContainText('Removed: Ship on Monday');
  await expect(diff.locator('.diff-added')).toContainText('Added: Ship on Friday');
  await expect(diff.locator('del')).toHaveText('Monday');
  await expect(diff.locator('ins')).toHaveText('Friday');
  // Distant unchanged paragraphs collapse behind a button that expands them in place.
  await expect(diff).not.toContainText('Keep this line');
  const more = diff.getByRole('button', { name: /^Show \d+ unchanged lines$/ });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(diff).toContainText('Keep this line');
  await expect(diff.getByRole('button', { name: /unchanged line/ })).toHaveCount(0);
  // The line keeps its one-line geometry with the diff open below it.
  await expectOneLine(entry.getByTestId('activity-line').nth(2));
  await entry.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath(`diff-${browserName}-1440.png`) });
  // Light theme uses the same tokens' light values.
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  await page.screenshot({ path: testInfo.outputPath(`diff-light-${browserName}-1440.png`) });
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(diff).toBeHidden();

  for (const [width, height] of [
    [390, 844],
    [320, 700],
  ]) {
    await page.waitForLoadState('networkidle');
    await page.setViewportSize({ width, height });
    await page.reload();
    const phoneEntry = activityEntries(page).last();
    await phoneEntry.getByRole('button', { name: 'View changes', exact: true }).click();
    const phoneDiff = phoneEntry.locator('.activity-diff');
    await expect(phoneDiff).toBeVisible();
    // The description editor loads lazily after the reload; capture the settled page.
    await expect(page.locator('.document-description[aria-busy="true"]')).toHaveCount(0);
    await phoneEntry.scrollIntoViewIfNeeded();
    await noPageOverflow(page, width);
    // Long lines wrap inside the diff; it never scrolls sideways.
    expect(
      await phoneDiff.evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(0);
    const box = await phoneEntry.boundingBox();
    expect(box && box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`diff-${browserName}-${width}.png`) });
  }
  expect(errors).toEqual([]);
});
