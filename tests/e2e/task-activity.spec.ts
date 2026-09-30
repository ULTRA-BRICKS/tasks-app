import { test, expect, type Page } from '@playwright/test';
import { login } from './session-fixture';

async function saved(page: Page) {
  await expect(page.getByText('Saving…', { exact: true })).toHaveCount(0);
}

test('activity shows precise field changes and a keyboard-operable description diff', async ({
  page,
  browserName,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const headers = { Origin: new URL(page.url()).origin, 'x-tickets-csrf': '1' };
  const catalog = await (await page.request.get('/api/v1/catalog')).json();
  const created = await page.request.post('/api/v1/issues', {
    headers,
    data: {
      team_id: catalog.teams[0].id,
      title: `Activity changes ${browserName} ${Date.now()}`,
      description: 'Ship on Monday\n\nKeep this line',
    },
  });
  expect(created.status()).toBe(201);
  const task = await created.json();
  const initialStatus = catalog.statuses.find(
    (status: { id: string; name: string }) => status.id === task.status_id,
  ).name;
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
  await editor.press('Enter');
  await editor.pressSequentially('Keep this line');
  await page.getByLabel('Title', { exact: true }).click();
  await saved(page);
  await expect
    .poll(
      async () => (await (await page.request.get('/api/v1/issues/' + task.id)).json()).description,
    )
    .toContain('Ship on Friday');

  const activity = page.locator('.activity-section');
  // Three edits by one person within minutes read as one entry that keeps every change.
  const entry = activity.getByTestId('activity-entry').last();
  await expect(entry).toContainText('Alex Morgan updated the task');
  const row = (label: string) =>
    entry.locator('.activity-change').filter({ has: page.locator('dt', { hasText: label }) });
  await expect(row('Status').locator('dd')).toHaveText(`${initialStatus} → Done`);
  await expect(row('Assignee').locator('dd')).toHaveText('Unassigned → Alex Morgan');
  await expect(activity).not.toContainText(/\bissues?\b/i);
  await expect(activity).not.toContainText(task.status_id);

  const toggle = row('Description').getByText('View changes', { exact: true });
  await toggle.focus();
  await page.keyboard.press('Enter');
  const diff = row('Description').locator('.activity-diff');
  await expect(diff).toBeVisible();
  await expect(row('Description').getByText('Hide changes', { exact: true })).toBeVisible();
  await expect(diff.locator('.diff-removed')).toContainText('Removed: Ship on Monday');
  await expect(diff.locator('.diff-added')).toContainText('Added: Ship on Friday');
  await expect(diff.locator('del')).toHaveText('Monday');
  await expect(diff.locator('ins')).toHaveText('Friday');
  await expect(diff).toContainText('Keep this line');
  await entry.screenshot({ path: testInfo.outputPath(`activity-${browserName}-1440.png`) });
  await entry.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath(`activity-${browserName}-1440-page.png`) });
  await page.keyboard.press('Enter');
  await expect(diff).toBeHidden();

  for (const [width, height] of [
    [390, 844],
    [320, 700],
  ]) {
    await page.waitForLoadState('networkidle');
    await page.setViewportSize({ width, height });
    await page.reload();
    const phoneEntry = page.locator('.activity-section').getByTestId('activity-entry').last();
    await phoneEntry.getByText('View changes', { exact: true }).click();
    await expect(phoneEntry.locator('.activity-diff')).toBeVisible();
    await phoneEntry.scrollIntoViewIfNeeded();
    // The description editor loads lazily after the reload; capture the settled page.
    await expect(page.locator('.document-description[aria-busy="true"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    const box = await phoneEntry.boundingBox();
    expect(box && box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`activity-${browserName}-${width}.png`) });
  }
  expect(errors).toEqual([]);
});
