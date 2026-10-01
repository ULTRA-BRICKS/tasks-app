import { test, expect, type Locator, type Page } from '@playwright/test';
import { login } from './session-fixture';
import { photos, slackProfileFixture } from './slack-profile-fixture';

const loaded = (image: Locator) =>
  expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
async function expectPhoto(avatar: Locator, src: string) {
  await avatar.scrollIntoViewIfNeeded();
  const image = avatar.locator('img');
  await expect(image).toHaveAttribute('src', src);
  await loaded(image);
}
async function expectInitials(avatar: Locator, initials: string) {
  await avatar.scrollIntoViewIfNeeded();
  await expect(avatar.locator('img')).toHaveCount(0);
  await expect(avatar).toHaveText(initials);
}
/** Integrations as a deployment with the Slack bot token and team would report them. */
async function configuredIntegrations(page: Page) {
  await page.route('**/api/v1/integrations', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.slack.profiles_configured = true;
    data.slack.profile_sync = null;
    await route.fulfill({ response, json: data });
  });
}

test('Slack names and photos show in task rows, previews, pickers, the board, People and person cards; a broken photo falls back to initials', async ({
  page,
}) => {
  await slackProfileFixture(page);
  await login(page);
  const alexRow = page.getByRole('combobox', { name: /: Alex M\.$/ }).first();
  await expectPhoto(alexRow.locator('.avatar'), photos.alex);
  await expectInitials(
    page
      .getByRole('combobox', { name: /: Jamie C\.$/ })
      .first()
      .locator('.avatar'),
    'JC',
  );
  // The task preview's assignee shows the same name and photo as the row.
  await page
    .locator('.peek-anchor')
    .filter({ has: page.getByRole('combobox', { name: /: Alex M\.$/ }) })
    .first()
    .getByRole('button', { name: /^Preview TKT-/ })
    .click();
  const preview = page.getByRole('dialog', { name: 'Task preview', exact: true });
  const assignee = preview.locator('.peek-chip').filter({ has: page.locator('.avatar') });
  await expect(assignee).toHaveText('Alex M.');
  await expectPhoto(assignee.locator('.avatar'), photos.alex);
  await page.keyboard.press('Escape');
  await expect(preview).toBeHidden();
  // Pickers show Slack names and photos, and still find people by earlier names and emails.
  await alexRow.click();
  const search = page.getByRole('combobox', { name: 'Search people' });
  await expect(search).toBeFocused();
  const options = page.getByRole('option');
  await expectPhoto(options.filter({ hasText: 'Robin P.' }).locator('.avatar'), photos.robin);
  for (const [query, name] of [
    ['Robin Park', 'Robin P.'],
    ['robin.park@old', 'Robin P.'],
    ['Jamie Chen', 'Jamie C.'],
    ['jamie.chen@example.test', 'Jamie C.'],
  ]) {
    await search.fill(query);
    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText(name);
  }
  await page.keyboard.press('Escape');
  await expect(search).toBeHidden();
  // Board cards take the photo from the same projection.
  await page.getByRole('button', { name: 'Board view', exact: true }).click();
  await expectPhoto(
    page
      .locator('.issue-card .avatar')
      .filter({ has: page.locator(`img[src="${photos.alex}"]`) })
      .first(),
    photos.alex,
  );
  // A dragged card has no assignee control; it keeps the Slack name and photo.
  await page
    .locator('.draggable-card')
    .filter({ has: page.getByRole('combobox', { name: /: Alex M\.$/ }) })
    .first()
    .getByRole('button', { name: /^Move TKT-/ })
    .focus();
  await page.keyboard.press('Space');
  const dragged = page.locator('.drag-preview .avatar');
  await expect(dragged).toHaveAttribute('aria-label', 'Alex M.');
  await expectPhoto(dragged, photos.alex);
  await page.keyboard.press('Escape');
  await expect(page.locator('.drag-preview')).toHaveCount(0);
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  // Activity names the person from the projection; the card shows the Slack photo.
  await page.locator('.issue-open').first().click();
  const created = page
    .locator('.activity-section')
    .getByTestId('activity-entry')
    .filter({ hasText: 'created the task' })
    .getByRole('button', { name: 'Alex M.', exact: true });
  await created.click();
  const card = page.getByRole('dialog', { name: 'Alex M.', exact: true });
  await expect(card).toBeVisible();
  await expectPhoto(card.locator('.avatar'), photos.alex);
  await page.keyboard.press('Escape');
  // People settings: the account row keeps its account name and shows the Slack photo.
  await page.goto('/settings?tab=members');
  const rows = page.locator('.member-row');
  await expectPhoto(
    rows.filter({ hasText: 'Alex Morgan' }).locator('.avatar').first(),
    photos.alex,
  );
  await expectInitials(rows.filter({ hasText: 'Jamie Chen' }).locator('.avatar').first(), 'JC');
  await expect(page.getByText('· imported')).toHaveCount(0);
});

test('an administrator syncs Slack profiles from Settings and sees the summary or the error', async ({
  page,
}) => {
  await configuredIntegrations(page);
  let calls = 0;
  // The first sync stays in flight until the pending state has been checked.
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  await page.route('**/api/v1/integrations/slack/profiles/sync', async (route) => {
    calls += 1;
    expect(route.request().method()).toBe('POST');
    if (calls === 1) {
      await released;
      return route.fulfill({
        json: {
          synced_at: '2026-09-30T12:00:00.000Z',
          counts: {
            mapped: 3,
            created: 2,
            updated: 1,
            unchanged: 0,
            deactivated: 1,
            bots: 0,
            cross_workspace: 0,
            not_found: 0,
          },
          cross_workspace: [],
          not_found: [],
        },
      });
    }
    return route.fulfill({
      status: 429,
      json: {
        error: {
          code: 'SLACK_RATE_LIMITED',
          message: 'Slack is rate limiting requests. Try again in 30 seconds.',
          details: { retry_after: 30 },
        },
      },
    });
  });
  await login(page);
  await page.goto('/settings?tab=integrations');
  const section = page.getByRole('region', { name: 'Slack profiles' });
  const sync = section.getByRole('button', { name: 'Sync Slack profiles' });
  await expect(sync).toBeEnabled();
  await sync.click();
  await expect(section.getByRole('button', { name: 'Syncing…' })).toBeDisabled();
  release();
  await expect(section.locator('output')).toHaveText(
    'Synced 3 of 3 mapped people · 2 new · 1 updated · 1 deactivated in Slack',
  );
  await sync.click();
  await expect(section.getByRole('alert')).toContainText(
    'Slack is rate limiting requests. Try again in 30 seconds.',
  );
  expect(calls).toBe(2);
});

test('without the Slack bot token and team the sync is disabled and names the missing variables', async ({
  page,
}) => {
  await login(page);
  await page.goto('/settings?tab=integrations');
  const section = page.getByRole('region', { name: 'Slack profiles' });
  const sync = section.getByRole('button', { name: 'Sync Slack profiles' });
  await expect(sync).toBeDisabled();
  await expect(sync).toHaveAccessibleDescription(
    /SLACK_BOT_TOKEN, SLACK_TEAM_ID and INTEGRATIONS_WORKSPACE_ID/,
  );
  // On a phone the action keeps a full touch target beside the long explanation.
  await page.setViewportSize({ width: 320, height: 700 });
  await sync.scrollIntoViewIfNeeded();
  expect((await sync.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('members see no Slack profile sync, and the server refuses it', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('jamie.chen@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
  await page.goto('/settings?tab=integrations');
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Integrations' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sync Slack profiles' })).toHaveCount(0);
  const refused = await page.request.post('/api/v1/integrations/slack/profiles/sync', {
    headers: { 'x-tickets-csrf': '1' },
  });
  expect(refused.status()).toBe(403);
});
