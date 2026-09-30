import { test, expect, type Page, type Locator } from '@playwright/test';
import { login } from './session-fixture';
import { identityFixture, type Person } from './identity-fixture';
/** Jamie's catalog record and the first task assigned to Jamie. */
async function jamieTask(page: Page) {
  const catalog = await (await page.request.get('/api/v1/catalog')).json();
  const jamie: Person = catalog.people.find((p: Person) => p.name === 'Jamie Chen');
  const list = await (
    await page.request.get('/api/v1/issues?limit=1&assignee_id=' + jamie.id)
  ).json();
  return { jamie, task: list.data[0] as { id: string; key: string; title: string } };
}
/** Opens a task assigned to Jamie and returns Jamie's catalog record. */
async function openJamieTask(page: Page) {
  const { jamie, task } = await jamieTask(page);
  await page.goto('/tasks/' + task.id);
  await descriptionMounted(page);
  const assignee = page
    .locator('.compact-property')
    .filter({ has: page.getByRole('combobox', { name: 'Assignee', exact: true }) });
  return { jamie, chip: assignee.getByRole('button', { name: 'Jamie Chen', exact: true }) };
}
/** The lazy description editor grows the document when it mounts and pushes the property rail
 * down; a tap before then lands where the chip was, not where it ends up. */
async function descriptionMounted(page: Page) {
  await expect(page.locator('.document-description[contenteditable=true]')).toBeVisible();
}
/** Opens the card from `trigger`, checks it (and `whileOpen`), and closes it again with Escape. */
async function expectCard(
  page: Page,
  trigger: Locator,
  name: string,
  text: string,
  whileOpen?: () => Promise<void>,
) {
  await trigger.click();
  const card = page.getByRole('dialog', { name, exact: true });
  await expect(card).toContainText(text);
  await whileOpen?.();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(trigger).toBeFocused();
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
test('comments and activity open the card of the person who wrote or changed the task', async ({
  page,
}) => {
  await identityFixture(page);
  await login(page);
  const list = await (await page.request.get('/api/v1/issues?limit=100')).json();
  const task = list.data.find(
    (i: { title: string }) => i.title === 'Preserve drafts when switching between issues',
  );
  // Imported history: a comment and a change by Jamie's Linear profile, and a change by Linear's
  // own automation, which has no person. The importer (the member) stays in author/actor_id.
  await page.route('**/api/v1/issues/' + task.id, async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const issue = await response.json();
    const importer = issue.comments[0].author_id;
    const at = new Date().toISOString();
    const imported = (id: string, source: string | null, name: string, summary: string) => ({
      id,
      actor_id: importer,
      actor_source_id: source,
      actor_name: name,
      action: 'linear_imported_change',
      data: {},
      summary,
      created_at: at,
    });
    issue.activity = [
      imported(
        'bbbbbbbb-0000-4000-8000-000000000001',
        null,
        'Linear automation',
        'closed the task in Linear',
      ),
      imported(
        'bbbbbbbb-0000-4000-8000-000000000002',
        'aaaaaaaa-0000-4000-8000-000000000001',
        'jchen',
        'moved the task in Linear',
      ),
      ...issue.activity,
    ];
    issue.comments.push({
      ...issue.comments[0],
      id: 'bbbbbbbb-0000-4000-8000-000000000003',
      author_source_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      author_name: 'jchen',
      body: 'Imported from Linear.',
      created_at: at,
    });
    await route.fulfill({ response, json: issue });
  });
  await page.goto('/tasks/' + task.id);
  await descriptionMounted(page);
  const comments = page.locator('.comment');
  await expectCard(
    page,
    comments.first().getByRole('button', { name: 'Alex Morgan', exact: true }),
    'Alex Morgan',
    'Owner · You',
  );
  // The imported author opens the canonical person (named from the bound Slack profile, as in
  // UB-29), not the importer.
  await expectCard(
    page,
    comments.last().getByRole('button', { name: 'Jamie C.', exact: true }),
    'Jamie C.',
    'Tasks · Linear · Slack',
  );
  const activity = page.locator('.activity-section').getByTestId('activity-entry');
  await expectCard(
    page,
    activity.filter({ hasText: 'moved the task in Linear' }).getByRole('button', {
      name: 'Jamie C.',
      exact: true,
    }),
    'Jamie C.',
    'Tasks · Linear · Slack',
  );
  const native = activity.filter({ hasText: 'Alex Morgan created the task' });
  await expectCard(
    page,
    native.getByRole('button', { name: 'Alex Morgan', exact: true }),
    'Alex Morgan',
    'Owner · You',
  );
  // Linear automation has no person to show.
  const automation = activity.filter({ hasText: 'closed the task in Linear' });
  await expect(automation).toContainText('Linear automation closed the task in Linear');
  await expect(automation.getByRole('button')).toHaveCount(0);
});
test('People, project and initiative surfaces open the person’s card', async ({ page }) => {
  await login(page);
  const catalog = await (await page.request.get('/api/v1/catalog')).json();
  const jamie: Person = catalog.people.find((p: Person) => p.name === 'Jamie Chen');
  // Desktop sidebar: the signed-in person. Opening the card must not reflow the profile row.
  const nav = page.getByRole('complementary', { name: 'Workspace navigation' });
  const signOut = nav.getByRole('button', { name: 'Sign out', exact: true });
  const before = await signOut.boundingBox();
  await expectCard(
    page,
    nav.getByRole('button', { name: 'Alex Morgan', exact: true }),
    'Alex Morgan',
    'Owner · You',
    async () => expect(await signOut.boundingBox()).toEqual(before),
  );
  // People settings: the member's name.
  await page.goto('/settings?tab=members');
  await expectCard(
    page,
    page
      .locator('.member-row')
      .filter({ hasText: jamie.email })
      .getByRole('button', { name: 'Jamie Chen', exact: true }),
    'Jamie Chen',
    jamie.email,
  );
  // Projects list: the lead's avatar on the demo project Jamie leads.
  await page.goto('/projects');
  await expectCard(
    page,
    page
      .locator('.project-card')
      .filter({ hasText: 'Developer experience' })
      .getByRole('button', { name: 'Jamie Chen', exact: true }),
    'Jamie Chen',
    jamie.email,
  );
  // Project page: the avatar beside the Project lead picker; the picker keeps the value.
  const projects = await (await page.request.get('/api/v1/projects')).json();
  const project = (Array.isArray(projects) ? projects : projects.data).find(
    (p: { name: string }) => p.name === 'Developer experience',
  );
  await page.goto('/projects/' + project.id);
  const lead = page.getByRole('combobox', { name: 'Project lead', exact: true });
  await expectCard(
    page,
    page
      .locator('.compact-property')
      .filter({ has: lead })
      .getByRole('button', { name: 'Jamie Chen', exact: true }),
    'Jamie Chen',
    jamie.email,
  );
  await expect(lead).toHaveText(/Jamie Chen/);
  // Initiative page: the avatar beside the Owner picker.
  const initiative = await (
    await page.request.post('/api/v1/initiatives', {
      headers: { Origin: new URL(page.url()).origin, 'x-tickets-csrf': '1' },
      data: { name: 'Person card initiative ' + test.info().project.name, owner_id: jamie.id },
    })
  ).json();
  await page.goto('/initiatives/' + initiative.id);
  const owner = page.getByRole('combobox', { name: 'Owner', exact: true });
  await expectCard(
    page,
    page
      .locator('.knowledge-person')
      .filter({ has: owner })
      .getByRole('button', { name: 'Jamie Chen', exact: true }),
    'Jamie Chen',
    jamie.email,
  );
  await expect(owner).toHaveText(/Jamie Chen/);
});
test('on a phone the drawer profile opens the signed-in card and View tasks closes the drawer', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await login(page);
    const me = await (await page.request.get('/api/v1/me')).json();
    await page.getByRole('button', { name: 'More navigation', exact: true }).tap();
    const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true });
    await drawer.getByRole('button', { name: 'Alex Morgan', exact: true }).tap();
    const card = page.getByRole('dialog', { name: 'Alex Morgan', exact: true });
    await expect(card).toContainText('Owner · You');
    await expect(card).toBeInViewport({ ratio: 1 });
    await card.getByRole('link', { name: 'View tasks', exact: true }).tap();
    await expect(page).toHaveURL(new RegExp('/tasks\\?assignee_id=' + me.id + '$'));
    await expect(card).toHaveCount(0);
    await expect(drawer).toHaveCount(0);
  } finally {
    await context.close();
  }
});
/** The task list filtered to Jamie's tasks, as rows or as the board, its first row or card and
 * that one's assignee picker (the UB-43 avatar). */
async function jamieRow(page: Page, view: 'list' | 'board' = 'list') {
  const catalog = await (await page.request.get('/api/v1/catalog')).json();
  const jamie: Person = catalog.people.find((p: Person) => p.name === 'Jamie Chen');
  await page.goto('/tasks?assignee_id=' + jamie.id);
  if (view === 'board') await page.getByRole('button', { name: 'Board view', exact: true }).click();
  const assignee = /^Assignee for .+: Jamie Chen$/;
  const row = (view === 'board' ? page.locator('.issue-card') : page.getByTestId('issue-row'))
    .filter({ has: page.getByRole('combobox', { name: assignee }) })
    .first();
  const picker = row.getByRole('combobox', { name: assignee });
  await expect(picker).toBeVisible();
  return { catalog, jamie, row, picker };
}
/** The server's own `me` answer with the viewer role. */
async function asViewer(page: Page) {
  await page.route('**/api/v1/me', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), role: 'viewer', scopes: ['read'] },
    });
  });
}
/** The card lies directly below or above the control it was opened from. */
async function expectAgainst(card: Locator, control: Locator) {
  const at = await control.boundingBox(),
    box = await card.boundingBox();
  if (!at || !box) throw new Error('not laid out');
  expect(
    Math.min(Math.abs(box.y - (at.y + at.height)), Math.abs(at.y - (box.y + box.height))),
  ).toBeLessThanOrEqual(12);
}
test('a list row avatar keeps assigning, and its View profile opens the card at the avatar', async ({
  page,
}) => {
  await login(page);
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH') writes.push(request.url());
  });
  const { catalog, jamie, row, picker } = await jamieRow(page);
  const card = page.getByRole('dialog', { name: 'Jamie Chen', exact: true });
  const options = page.getByRole('listbox', { name: /^Assignee for / }).getByRole('option');
  // Pointer: the avatar still opens the assignee picker, now led by View profile.
  await picker.click();
  await expect(options.first()).toHaveText('View profile');
  await expect(page.getByRole('option', { name: 'Unassigned', exact: true })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await options.first().click();
  await expect(card).toContainText(jamie.email);
  await expect(page.getByRole('listbox')).toHaveCount(0);
  // The card sits against the row avatar, directly below or above it.
  await expectAgainst(card, picker);
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(picker).toBeFocused();
  // Keyboard: Enter opens the picker in its search field on the current assignee; View profile
  // leads the list above it, so ArrowUp reaches it, and Enter enters the card.
  const search = page.getByRole('combobox', { name: 'Search people', exact: true });
  const viewProfile = async () => {
    await page.keyboard.press('Enter');
    await expect(search).toBeFocused();
    await expect(options.filter({ hasText: 'Jamie Chen' })).toHaveAttribute('data-highlighted');
    const above = await options.evaluateAll((items) =>
      items.findIndex((item) => item.hasAttribute('data-highlighted')),
    );
    for (let step = 0; step < above; step++) await page.keyboard.press('ArrowUp');
    await expect(options.first()).toHaveAttribute('data-highlighted');
    await page.keyboard.press('Enter');
    await expect(card.getByRole('link', { name: 'View tasks', exact: true })).toBeFocused();
  };
  await viewProfile();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(picker).toBeFocused();
  // Shift+Tab leaves the card from the avatar, back into the row.
  await viewProfile();
  await page.keyboard.press('Shift+Tab');
  await expect(card).toHaveCount(0);
  await expect(row.locator('.issue-open')).toBeFocused();
  // The card never assigns.
  expect(writes).toEqual([]);
  // An unassigned row has nobody to show.
  const title = 'Unassigned row ' + test.info().project.name + ' ' + Date.now();
  const created = await page.request.post('/api/v1/issues', {
    headers: { Origin: new URL(page.url()).origin, 'x-tickets-csrf': '1' },
    data: { team_id: catalog.teams[0].id, title },
  });
  expect(created.status()).toBe(201);
  const task = await created.json();
  await page.goto('/tasks?q=' + encodeURIComponent(title));
  await page
    .getByRole('combobox', { name: 'Assignee for ' + task.key + ': Unassigned', exact: true })
    .click();
  await expect(page.getByRole('option', { name: 'Jamie Chen', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'View profile' })).toHaveCount(0);
});
for (const [view, surface] of [
  ['list', 'row'],
  ['board', 'board card'],
] as const)
  test(`on a phone a viewer opens a ${surface}’s card from the assignee picker but cannot assign`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const page = await context.newPage();
    try {
      await login(page);
      await asViewer(page);
      const { jamie, picker } = await jamieRow(page, view);
      await picker.tap();
      await expect(page.getByRole('option', { name: 'Unassigned', exact: true })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      // Playwright WebKit's touch emulation sends no click after a tap on an option whose
      // pointerdown is cancelled (Base UI does); iOS Safari still clicks. So the option is chosen
      // with a click; the avatar above was tapped.
      await page.getByRole('option', { name: 'View profile', exact: true }).click();
      const card = page.getByRole('dialog', { name: 'Jamie Chen', exact: true });
      await expect(card).toContainText(jamie.email);
      await expect(card).toBeInViewport({ ratio: 1 });
      await expect(picker).toBeInViewport();
      await expect(card.getByRole('link', { name: 'View tasks', exact: true })).toBeVisible();
      await expect(picker).toHaveAccessibleName(/: Jamie Chen$/);
      await expect(page.getByRole('dialog', { name: 'Task preview' })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
test('a board card’s assignee avatar offers View profile, and the card opens at the avatar', async ({
  page,
}) => {
  await login(page);
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH') writes.push(request.url());
  });
  const { jamie, picker } = await jamieRow(page, 'board');
  const card = page.getByRole('dialog', { name: 'Jamie Chen', exact: true });
  await picker.click();
  const options = page.getByRole('listbox', { name: /^Assignee for / }).getByRole('option');
  await expect(options.first()).toHaveText('View profile');
  await options.first().click();
  await expect(card).toContainText(jamie.email);
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expectAgainst(card, picker);
  // The card is portalled out of the board card: a press in it opens neither the task nor its
  // preview.
  const url = page.url();
  await card.getByText(jamie.email).click();
  await expect(card).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Task preview' })).toHaveCount(0);
  expect(page.url()).toBe(url);
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(picker).toBeFocused();
  expect(writes).toEqual([]);
});
/**
 * Opens the preview of a task assigned to Jamie from a list found by its title, so the person's
 * View tasks leads somewhere else.
 */
async function jamiePreview(page: Page, press: 'click' | 'tap' = 'click') {
  const { jamie, task } = await jamieTask(page);
  await page.goto('/tasks?q=' + encodeURIComponent(task.title));
  const trigger = page.getByRole('button', { name: 'Preview ' + task.key, exact: true });
  await trigger[press]();
  const preview = page.getByRole('dialog', { name: 'Task preview', exact: true });
  await expect(preview).toBeVisible();
  const chip = preview.getByRole('button', { name: 'Jamie Chen', exact: true });
  return { jamie, preview, trigger, chip };
}
/** Where the card and the preview overlap, the card is on top. */
async function expectAbove(card: Locator, preview: Locator) {
  const a = (await card.boundingBox())!,
    b = (await preview.boundingBox())!;
  const left = Math.max(a.x, b.x),
    top = Math.max(a.y, b.y),
    right = Math.min(a.x + a.width, b.x + b.width),
    bottom = Math.min(a.y + a.height, b.y + b.height);
  expect(right - left).toBeGreaterThan(20);
  expect(bottom - top).toBeGreaterThan(20);
  const point = { x: (left + right) / 2, y: (top + bottom) / 2 };
  expect(
    await card.evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), point),
  ).toBe(true);
}
test('the task preview’s assignee opens the card above the preview, and the card closes first', async ({
  page,
}) => {
  await login(page);
  const { jamie, preview, trigger, chip } = await jamiePreview(page);
  const card = page.getByRole('dialog', { name: 'Jamie Chen', exact: true });
  // The whole pill is the trigger: a click at its rounded edge, left of the avatar, opens the card.
  const pill = chip.locator('..'),
    height = (await pill.boundingBox())!.height;
  await pill.click({ position: { x: 4, y: height / 2 } });
  await expect(card).toContainText(jamie.email);
  await expectAbove(card, preview);
  // A press inside the card is not an outside press for the preview.
  await card.getByText(jamie.email).click();
  await expect(card).toBeVisible();
  await expect(preview).toBeVisible();
  // Escape closes the card and returns focus to the chip; the next Escape closes the preview.
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(preview).toBeVisible();
  await expect(chip).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  // An outside press, too, closes the card first.
  await trigger.click();
  await chip.click();
  await expect(card).toBeVisible();
  const heading = page.getByRole('heading', { level: 1 });
  await heading.click();
  await expect(card).toHaveCount(0);
  await expect(preview).toBeVisible();
  await heading.click();
  await expect(preview).toHaveCount(0);
  // View tasks leaves the previewed list for the person's tasks, and the preview closes.
  await trigger.click();
  await chip.click();
  await card.getByRole('link', { name: 'View tasks', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('[?&]assignee_id=' + jamie.id));
  await expect(preview).toHaveCount(0);
  await expect(card).toHaveCount(0);
});
test('on a phone a viewer opens the preview assignee’s whole card; a tap outside closes the card first', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await login(page);
    await asViewer(page);
    const { jamie, preview, chip } = await jamiePreview(page, 'tap');
    const card = page.getByRole('dialog', { name: 'Jamie Chen', exact: true });
    await chip.tap();
    await expect(card).toContainText(jamie.email);
    await expect(card).toBeInViewport({ ratio: 1 });
    await expectAbove(card, preview);
    // The dimmed strip above the preview, clear of the card.
    const outside = { x: 195, y: 12 },
      box = (await card.boundingBox())!;
    expect(box.y).toBeGreaterThan(outside.y);
    const url = page.url();
    await page.touchscreen.tap(outside.x, outside.y);
    await expect(card).toHaveCount(0);
    await expect(preview).toBeVisible();
    await page.touchscreen.tap(outside.x, outside.y);
    await expect(preview).toHaveCount(0);
    expect(page.url()).toBe(url);
  } finally {
    await context.close();
  }
});
