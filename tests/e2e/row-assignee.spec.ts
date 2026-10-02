import { test, expect, type Locator, type Page, type Request } from '@playwright/test';
import { identityFixture } from './identity-fixture';
import { login } from './session-fixture';

// Acceptance for docs/ROW-ASSIGNEE.md (UB-43).

type Person = { id: string; name: string; email: string };
type Issue = { id: string; key: string; assignee_id: string | null; version: number };
/** The seeded members (packages/server/demo.mjs); other specs may add people to the shared server. */
const SEEDED = ['Alex Morgan', 'Jamie Chen', 'Sam Rivera', 'Taylor Park', 'Casey Brooks'];
/** Long enough for a second, stray save after the first to have been sent. */
const SETTLE_MS = 500;

const rows = (page: Page) => page.getByTestId('issue-row');
const avatarOf = (scope: Locator) => scope.getByRole('combobox', { name: /^Assignee for / });
/** A row by its exact key: saving re-sorts the list, so a position does not name a task. */
const rowByKey = (page: Page, key: string) =>
  rows(page).filter({ has: page.locator('.issue-key', { hasText: new RegExp(`^${key}$`) }) });
/** A suggestion by its visible name; the option's accessible name also carries the email. */
const suggestion = (page: Page, name: string) =>
  page
    .getByRole('listbox')
    .getByRole('option')
    .filter({ has: page.getByText(name, { exact: true }) });

function issueWrites(page: Page) {
  const sent: Request[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'PATCH' &&
      /^\/api\/v1\/issues\//.test(new URL(request.url()).pathname)
    )
      sent.push(request);
  });
  return sent;
}
async function seededPeople(page: Page): Promise<Person[]> {
  const catalog = await (await page.request.get('/api/v1/catalog')).json();
  return catalog.people.filter((person: Person) => SEEDED.includes(person.name));
}
async function serverIssues(page: Page): Promise<Issue[]> {
  const body = await (await page.request.get('/api/v1/issues?limit=200')).json();
  return body.data.map(({ id, key, assignee_id, version }: Issue) => ({
    id,
    key,
    assignee_id,
    version,
  }));
}
/** Every row's key, avatar name, checkbox and selected state, in list order. */
function rowState(page: Page) {
  return rows(page).evaluateAll((elements) =>
    elements.map((row) => ({
      key: row.querySelector('.issue-key')?.textContent ?? '',
      assignee: row.querySelector('[role="combobox"]')?.getAttribute('aria-label') ?? '',
      checked: row.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked ?? false,
      selected: row.classList.contains('is-selected'),
    })),
  );
}
const selection = async (page: Page) =>
  (await rowState(page)).map(({ key, checked, selected }) => ({ key, checked, selected }));
/** A seeded person other than the task's current assignee. */
async function anotherPerson(page: Page, issue: Issue) {
  const person = (await seededPeople(page)).find((p) => p.id !== issue.assignee_id);
  expect(person).toBeDefined();
  return person!;
}
async function issueOfRow(page: Page, row: Locator) {
  const key = (await row.locator('.issue-key').innerText()).trim();
  const issue = (await serverIssues(page)).find((candidate) => candidate.key === key);
  expect(issue, key).toBeDefined();
  return issue!;
}
/** Puts the assignee back through the API against the current version. */
async function restoreAssignee(page: Page, issue: Issue) {
  const current = await (await page.request.get('/api/v1/issues/' + issue.id)).json();
  if (current.assignee_id === issue.assignee_id) return;
  const restored = await page.request.patch('/api/v1/issues/' + issue.id, {
    headers: { 'x-tickets-csrf': '1' },
    data: { assignee_id: issue.assignee_id, version: current.version },
  });
  expect(restored.status()).toBe(200);
}
/** Chooses a person in the avatar's picker and returns the server's answer to that task's save. */
async function assignFromAvatar(page: Page, avatar: Locator, issue: Issue, name: string) {
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname === '/api/v1/issues/' + issue.id,
  );
  await avatar.click();
  await suggestion(page, name).click();
  return saved;
}

test.describe('desktop', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('suggestions show each person’s avatar, name and email after Unassigned', async ({
    page,
  }) => {
    const team = await seededPeople(page);
    expect(team).toHaveLength(SEEDED.length);
    await avatarOf(rows(page).first()).click();
    const list = page.getByRole('listbox');
    const values = list.getByRole('option').and(list.locator(':not(.combobox-command)'));
    await expect(values.first()).toHaveText('Unassigned');
    await expect(values.first().locator('.picker-item-description')).toHaveCount(0);
    for (const person of team) {
      const option = suggestion(page, person.name);
      await expect(option).toHaveCount(1);
      await expect(option.locator('.avatar')).toBeVisible();
      await expect(option.locator('.picker-item-description')).toHaveText(person.email);
    }
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
  });

  test('search finds a person by email and by the name of another linked profile', async ({
    page,
  }) => {
    // Jamie's Slack name leads (UB-29), so the member name and the Linear handle are aliases.
    await identityFixture(page);
    await page.reload();
    const taylor = (await seededPeople(page)).find((person) => person.name === 'Taylor Park')!;
    const avatar = avatarOf(rows(page).first());
    const options = page.getByRole('listbox').getByRole('option');
    await avatar.click();
    await expect(page.locator('.combobox-popup').locator('input')).toHaveCount(0);
    await expect(avatar).toHaveJSProperty('tagName', 'INPUT');
    await expect(avatar).toBeFocused();
    await avatar.fill(taylor.email.slice(0, taylor.email.indexOf('@') + 1));
    await expect(options).toHaveCount(1);
    await expect(options.locator('.picker-item-text')).toHaveText('Taylor Park');
    for (const alias of ['jchen', 'Jamie Chen']) {
      await avatar.fill(alias);
      await expect(options).toHaveCount(1);
      await expect(options.locator('.picker-item-text')).toHaveText('Jamie C.');
    }
    await page.keyboard.press('Escape');
    await expect(avatar).toBeFocused();
  });

  for (const key of ['Enter', 'Space'])
    test(`${key} on the avatar opens its picker, not a peek or the task`, async ({ page }) => {
      const avatar = avatarOf(rows(page).first());
      const url = page.url();
      await avatar.focus();
      await page.keyboard.press(key);
      await expect(page.getByRole('listbox')).toBeVisible();
      await expect(page.getByRole('dialog', { name: 'Task preview', exact: true })).toHaveCount(0);
      expect(page.url()).toBe(url);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('listbox')).toHaveCount(0);
      await expect(avatar).toBeFocused();
    });

  test('opening and closing an avatar picker keeps the URL and the selected rows', async ({
    page,
  }) => {
    const sent = issueWrites(page);
    await rows(page).nth(1).getByRole('checkbox').check();
    const url = page.url(),
      selected = await selection(page);
    expect(selected.filter((row) => row.selected)).toHaveLength(1);
    // The selected row's own avatar and another row's avatar.
    for (const index of [1, 0]) {
      await avatarOf(rows(page).nth(index)).click();
      await expect(page.getByRole('listbox')).toBeVisible();
      expect(page.url()).toBe(url);
      expect(await selection(page)).toEqual(selected);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('listbox')).toHaveCount(0);
      expect(await selection(page)).toEqual(selected);
    }
    expect(sent).toHaveLength(0);
    await rows(page).nth(1).getByRole('checkbox').uncheck();
  });

  test('Shift-click on an avatar opens its picker without assigning or extending the selection', async ({
    page,
  }) => {
    const sent = issueWrites(page);
    await rows(page).first().getByRole('checkbox').check();
    const url = page.url(),
      selected = await selection(page);
    await avatarOf(rows(page).nth(2)).click({ modifiers: ['Shift'] });
    await expect(page.getByRole('listbox')).toBeVisible();
    expect(await selection(page)).toEqual(selected);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await page.waitForTimeout(SETTLE_MS);
    expect(sent).toHaveLength(0);
    expect(await selection(page)).toEqual(selected);
    expect(page.url()).toBe(url);
    await rows(page).first().getByRole('checkbox').uncheck();
  });

  test('choosing a person saves that one task; every other row and record stays as it was', async ({
    page,
  }) => {
    const sent = issueWrites(page);
    const issue = await issueOfRow(page, rows(page).nth(1)),
      target = await anotherPerson(page, issue);
    const rowsBefore = await rowState(page),
      serverBefore = await serverIssues(page);
    const avatar = avatarOf(rowByKey(page, issue.key));
    try {
      expect((await assignFromAvatar(page, avatar, issue, target.name)).status()).toBe(200);
      await expect(avatar).toHaveAccessibleName(`Assignee for ${issue.key}: ${target.name}`);
      // Choosing returns focus to the avatar.
      await expect(avatar).toBeFocused();
      await page.waitForTimeout(SETTLE_MS);
      expect(sent).toHaveLength(1);
      expect(sent[0].postDataJSON()).toEqual({ assignee_id: target.id, version: issue.version });
      const rowsAfter = await rowState(page),
        serverAfter = await serverIssues(page);
      for (const before of rowsBefore.filter((row) => row.key !== issue.key))
        expect(rowsAfter.find((row) => row.key === before.key)?.assignee, before.key).toBe(
          before.assignee,
        );
      for (const before of serverBefore)
        expect(
          serverAfter.find((entry) => entry.id === before.id),
          before.key,
        ).toEqual(
          before.id === issue.id
            ? { ...before, assignee_id: target.id, version: expect.any(Number) }
            : before,
        );
    } finally {
      await restoreAssignee(page, issue);
    }
  });

  for (const [status, code, message] of [
    [403, 'READ_ONLY', 'Viewers cannot change workspace data'],
    [500, 'INTERNAL_ERROR', 'Request could not be completed'],
  ] as const)
    test(`a ${status} answer rolls the avatar back, says why and keeps focus`, async ({ page }) => {
      const issue = await issueOfRow(page, rows(page).first()),
        target = await anotherPerson(page, issue);
      const row = rowByKey(page, issue.key),
        avatar = avatarOf(row),
        original = (await avatar.getAttribute('aria-label'))!;
      await page.route('**/api/v1/issues/' + issue.id, (route) =>
        route.request().method() === 'PATCH'
          ? route.fulfill({ status, json: { error: { code, message } } })
          : route.continue(),
      );
      const sent = issueWrites(page);
      await avatar.click();
      await suggestion(page, target.name).click();
      await expect(row.getByRole('alert')).toHaveText(message);
      await expect(avatar).toHaveAttribute('aria-label', original);
      await expect(avatar).toBeFocused();
      await page.waitForTimeout(SETTLE_MS);
      expect(sent).toHaveLength(1);
      const stored = (await serverIssues(page)).find((entry) => entry.id === issue.id);
      expect(stored).toEqual(issue);
      await expect(avatar).toHaveAttribute('aria-label', original);
    });

  test('an assignment chosen from the avatar is still there after a reload', async ({ page }) => {
    const issue = await issueOfRow(page, rows(page).first()),
      target = await anotherPerson(page, issue);
    const avatar = avatarOf(rowByKey(page, issue.key));
    try {
      expect((await assignFromAvatar(page, avatar, issue, target.name)).status()).toBe(200);
      await page.reload();
      await expect(avatar).toHaveAccessibleName(`Assignee for ${issue.key}: ${target.name}`);
      await avatar.click();
      await expect(suggestion(page, target.name)).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('Escape');
    } finally {
      await restoreAssignee(page, issue);
    }
  });
});

/** The 8px edge every popup keeps (src/shared/lib/safe-area.ts), half a pixel for rounding. The
 * dock and safe-area insets on top of it are checked by phone-overflow.spec.ts. */
const EDGE = 8 - 0.5;
/** The popup keeps its padding from every viewport edge, its text stays inside it and the page
 * does not scroll sideways. */
async function expectPopupInside(page: Page, width: number, height: number) {
  const popup = page.locator('.combobox-popup');
  await expect(popup).toBeVisible();
  await expect(suggestion(page, 'Taylor Park')).toBeVisible();
  const box = (await popup.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(EDGE);
  expect(width - (box.x + box.width)).toBeGreaterThanOrEqual(EDGE);
  expect(box.y).toBeGreaterThanOrEqual(EDGE);
  expect(height - (box.y + box.height)).toBeGreaterThanOrEqual(EDGE);
  // A long email wraps inside its own column: no text runs past its box or the popup's edge.
  const overflowing = await popup
    .locator('.picker-item-description, .picker-item-text')
    .evaluateAll(
      (elements, right) =>
        elements
          .filter(
            (element) =>
              element.scrollWidth > element.clientWidth + 1 ||
              element.getBoundingClientRect().right > right + 0.5,
          )
          .map((element) => element.textContent),
      box.x + box.width,
    );
  expect(overflowing).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );
}

test.describe('phone', () => {
  for (const width of [320, 375, 393, 430])
    test(`the assignee popup of a row and of a board card stays inside a ${width}px screen`, async ({
      browser,
    }) => {
      const height = 800;
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: true });
      const page = await context.newPage();
      try {
        await login(page);
        const row = avatarOf(rows(page).first());
        await row.tap();
        await expectPopupInside(page, width, height);
        await page.keyboard.press('Escape');
        await expect(page.locator('.combobox-popup')).toHaveCount(0);

        await page.getByRole('button', { name: 'Board view', exact: true }).tap();
        const card = avatarOf(page.locator('.issue-card').first());
        await card.scrollIntoViewIfNeeded();
        await card.tap();
        await expectPopupInside(page, width, height);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'List view', exact: true }).tap();
      } finally {
        await context.close();
      }
    });
});
