import { test, expect, type Page } from '@playwright/test';
import { login } from './session-fixture';
import { peopleNamesSourceFixture } from '../unit/linear-import-fixture.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';

// UB-95 shapes (docs/PEOPLE-IDENTITY.md), synthetic data imported through the real Linear import:
// Niko is a Linear-only person whose Linear name is his address and who has no photo; Casey is a
// member without a photo whose Linear profile (named by its address) has one, like Danny.
/** A 1×1 orange PNG answered for every synthetic Linear photo. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN40GUDAAP0AadiirgwAAAAAElFTkSuQmCC',
  'base64',
);
type Imported = {
  taskId: string;
  nikoId: string;
  niko: string;
  casey: { email: string; avatarUrl: string };
};
let imported: Promise<Imported> | undefined;

/** One import per browser run; the fixture generates distinct Linear IDs, keys and addresses. */
function importPeople(page: Page) {
  imported ??= (async () => {
    const { source, niko, casey } = peopleNamesSourceFixture(
      'P' + crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase(),
    );
    const headers = { Origin: new URL(page.url()).origin, 'x-tickets-csrf': '1' };
    const create = await page.request.post('/api/v1/imports/linear', {
      headers,
      data: { manifest: source.manifest },
    });
    expect(create.status()).toBe(201);
    const run = (await create.json()).id;
    for (const [collection, records] of Object.entries(source.data))
      if (records.length)
        expect(
          (
            await page.request.post(`/api/v1/imports/linear/${run}/records`, {
              headers,
              data: { collection, records },
            })
          ).status(),
        ).toBe(200);
    const plan = await page.request.post(`/api/v1/imports/linear/${run}/plan`, { headers });
    expect(plan.status()).toBe(200);
    const apply = await page.request.post(`/api/v1/imports/linear/${run}/apply`, {
      headers,
      data: { plan_hash: (await plan.json()).plan_hash },
    });
    expect(apply.status()).toBe(200);
    const me = await (await page.request.get('/api/v1/me')).json();
    return {
      taskId: targetId(me.workspace_id, source.ids.org, 'issues', source.ids.issue),
      nikoId: targetId(me.workspace_id, source.ids.org, 'users', niko.id),
      niko: niko.email,
      casey: { email: casey.email, avatarUrl: casey.avatarUrl },
    };
  })();
  return imported;
}

test.beforeEach(async ({ page }) => {
  await page.route('https://avatars.example.test/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: PNG }),
  );
  await login(page);
});

test('People settings name and picture members and people without a Tasks account', async ({
  page,
}) => {
  const { niko, casey } = await importPeople(page);
  await page.goto('/settings?tab=members');
  // Danny shape: the member's own name, and the photo of his Linear profile.
  const caseyRow = page.locator('.member-row').filter({ hasText: casey.email });
  await expect(caseyRow.getByRole('button', { name: 'Casey Brooks', exact: true })).toBeVisible();
  await expect(caseyRow.locator('.avatar img')).toHaveAttribute('src', casey.avatarUrl);
  // Niko shape: listed although he has no account, by a name derived from his address.
  const others = page.getByRole('region', { name: 'People without a Tasks account' });
  await expect(others).not.toContainText(casey.email);
  const row = others.locator('.member-row').filter({ hasText: niko });
  await expect(row.getByRole('button', { name: 'Niko', exact: true })).toBeVisible();
  await expect(row).toContainText('Linear · ' + niko);
  await expect(row.locator('.avatar')).toHaveText('N');
  await expect(row.locator('.avatar')).toHaveAttribute('data-tone', /^[0-7]$/);
  await expect(others.getByRole('button', { name: niko })).toHaveCount(0);
  // The card opened from the name carries the same name and the address on its email line.
  await row.getByRole('button', { name: 'Niko', exact: true }).click();
  const card = page.getByRole('dialog', { name: 'Niko', exact: true });
  await expect(card).toBeVisible();
  await expect(card).toContainText(niko);
});

test('the assignee picker, list row, board avatar and activity never show an address as a name', async ({
  page,
}) => {
  const { taskId, nikoId, niko, casey } = await importPeople(page);
  await page.goto('/issues/' + taskId);
  const activity = page.locator('.activity-section');
  // Imported history and the imported comment, both by Niko.
  await expect(activity).toContainText('Unassigned → Niko');
  await expect(page.locator('.comment').first()).toContainText('Niko');
  await expect(activity).not.toContainText(niko);
  // Task property picker: plain names, none of them an address; Casey's photo from Linear.
  await page.getByRole('combobox', { name: 'Assignee', exact: true }).click();
  const labels = page.getByRole('listbox').locator('.picker-item-text');
  await expect(labels.filter({ hasText: /^Niko$/ })).toHaveCount(1);
  await expect(labels.filter({ hasText: '@' })).toHaveCount(0);
  const caseyOption = page
    .getByRole('listbox')
    .getByRole('option')
    .filter({ hasText: 'Casey Brooks' });
  await expect(caseyOption.locator('.avatar img')).toHaveAttribute('src', casey.avatarUrl);
  await page.keyboard.press('Escape');
  // The list row's avatar names the same person; its suggestions keep the address as the email.
  await page.goto('/issues?assignee_id=' + nikoId);
  const avatar = page.getByRole('combobox', { name: /^Assignee for [A-Z]+-\d+: Niko$/ }).first();
  await expect(avatar).toBeVisible();
  await expect(page.getByRole('combobox', { name: new RegExp(niko) })).toHaveCount(0);
  await avatar.click();
  const suggestion = page.getByRole('listbox').getByRole('option').filter({ hasText: niko });
  await expect(suggestion.locator('.picker-item-text')).toHaveText('Niko');
  await expect(suggestion.locator('.picker-item-description')).toHaveText(niko);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Board view', exact: true }).click();
  const boardCasey = page.getByRole('combobox', {
    name: /^Assignee for [A-Z]+-\d+: Casey Brooks$/,
  });
  await expect(boardCasey.locator('.avatar img')).toHaveAttribute('src', casey.avatarUrl);
});
