import { test, expect, type Page } from '@playwright/test';
import { login } from './session-fixture';
import { identityFixture, type Person } from './identity-fixture';
/** Opens a task assigned to Jamie and returns Jamie's catalog record. */
async function openJamieTask(page: Page) {
  const catalog = await (await page.request.get('/api/v1/catalog')).json();
  const jamie: Person = catalog.people.find((p: Person) => p.name === 'Jamie Chen');
  const list = await (
    await page.request.get('/api/v1/issues?limit=1&assignee_id=' + jamie.id)
  ).json();
  await page.goto('/tasks/' + list.data[0].id);
  // The lazy description editor grows the document when it mounts and pushes the property rail
  // down; a tap before then lands where the chip was, not where it ends up.
  await expect(page.locator('.document-description[contenteditable=true]')).toBeVisible();
  const assignee = page
    .locator('.compact-property')
    .filter({ has: page.getByRole('combobox', { name: 'Assignee', exact: true }) });
  return { jamie, chip: assignee.getByRole('button', { name: 'Jamie Chen', exact: true }) };
}
test('the task Assignee value opens Jamie’s card on hover, and Enter/Escape keep keyboard focus', async ({
  page,
}) => {
  await login(page);
  const { jamie, chip } = await openJamieTask(page);
  const card = page.getByRole('dialog', { name: 'Jamie Chen', exact: true });
  await chip.hover();
  await expect(card).toBeVisible();
  await expect(card).toContainText(jamie.email);
  await expect(card).toContainText('Member');
  await expect(card).toContainText('Tasks');
  await expect(chip).not.toBeFocused();
  await page.mouse.move(0, 0);
  await expect(card).toHaveCount(0);
  await chip.focus();
  await page.keyboard.press('Enter');
  await expect(card.getByRole('link', { name: 'View tasks', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(chip).toBeFocused();
  // The card never changes the assignment.
  await expect(page.getByRole('combobox', { name: 'Assignee', exact: true })).toHaveText(
    /Jamie Chen/,
  );
});
test('View tasks opens the task list filtered by that person', async ({ page }) => {
  await login(page);
  const { jamie, chip } = await openJamieTask(page);
  await chip.click();
  await page
    .getByRole('dialog', { name: 'Jamie Chen', exact: true })
    .getByRole('link', { name: 'View tasks', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp('/tasks\\?assignee_id=' + jamie.id + '$'));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // One active filter: the toolbar button reads "Filter 1".
  await page.getByRole('button', { name: /^Filter\b/ }).click();
  await expect(page.getByRole('combobox', { name: 'Filter by assignee' })).toContainText(
    'Jamie Chen',
  );
});
test('a phone tap on the Assignee value opens the card inside the viewport', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await login(page);
    const { chip } = await openJamieTask(page);
    await chip.tap();
    const card = page.getByRole('dialog', { name: 'Jamie Chen', exact: true });
    await expect(card).toBeVisible();
    // Opening must not scroll the trigger away: the card sits next to it, wholly on screen.
    await expect(chip).toBeInViewport();
    await expect(card).toBeInViewport({ ratio: 1 });
    const box = await card.boundingBox();
    if (!box) throw new Error('card is not laid out');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await expect(card.getByRole('link', { name: 'View tasks', exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
test('Identity review profiles open the canonical card with review and account details', async ({
  page,
}) => {
  await identityFixture(page);
  await login(page);
  await page.goto('/settings?tab=members');
  const review = page.getByRole('region', { name: 'Identity review' });
  await review.getByRole('button', { name: 'Sam R. (old)', exact: true }).click();
  const imported = page.getByRole('dialog', { name: 'Sam R. (old)', exact: true });
  await expect(imported).toContainText('No Tasks account');
  await expect(imported).toContainText('Linear');
  await expect(imported.getByText('Needs review', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(imported).toHaveCount(0);
});
