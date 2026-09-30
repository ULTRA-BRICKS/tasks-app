import type { Page } from '@playwright/test';
export type Person = { id: string; name: string; email: string; role: string };
/** Synthetic Slack photo hosts; requests to them never leave the browser. */
export const photos = {
  alex: 'https://avatars.slack-edge.com/2026-09-30/e2e-alex_192.png',
  robin: 'https://avatars.slack-edge.com/2026-09-30/e2e-robin_192.png',
  broken: 'https://avatars.slack-edge.com/2026-09-30/e2e-missing_192.png',
};
const photo = (color: string, letter: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><rect width="192" height="192" fill="${color}"/><circle cx="96" cy="78" r="38" fill="#fff" fill-opacity=".85"/><rect x="36" y="128" width="120" height="64" rx="32" fill="#fff" fill-opacity=".85"/><text x="96" y="92" font-size="40" text-anchor="middle" font-family="sans-serif" fill="${color}">${letter}</text></svg>`;
const slack = (id: string, name: string, avatar: string, sourceId: string) => ({
  id,
  name,
  email: null,
  avatar_url: avatar,
  provider: 'slack',
  source_id: sourceId,
});
export const ids = {
  alexSlack: 'cccccccc-0000-4000-8000-000000000341',
  jamieSlack: 'cccccccc-0000-4000-8000-000000000342',
  robinLinear: 'cccccccc-0000-4000-8000-000000000343',
  robinSlack: 'cccccccc-0000-4000-8000-000000000344',
};
/**
 * The catalog after a Slack profile sync (docs/SLACK-PROFILES.md): the signed-in owner and Jamie
 * are mapped members, Robin is a Linear-only author mapped through `source_person_map`, and
 * Jamie's Slack photo URL is broken. Stored data is untouched.
 */
export async function slackProfileFixture(page: Page) {
  await page.route('https://avatars.slack-edge.com/**', (route) =>
    route.request().url() === photos.broken
      ? route.fulfill({ status: 404, body: '' })
      : route.fulfill({
          contentType: 'image/svg+xml',
          body:
            route.request().url() === photos.alex ? photo('#2f7d6d', 'A') : photo('#8a4fd8', 'R'),
        }),
  );
  await page.route('**/api/v1/catalog', async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const data = await response.json();
    const alex = data.people.find((p: Person) => p.name === 'Alex Morgan');
    const jamie = data.people.find((p: Person) => p.name === 'Jamie Chen');
    data.source_people = [
      ...(data.source_people ?? []),
      slack(ids.alexSlack, 'Alex M.', photos.alex, 'T0E2E:U0ALEX'),
      slack(ids.jamieSlack, 'Jamie C.', photos.broken, 'T0E2E:U0JAMIE'),
      {
        id: ids.robinLinear,
        name: 'Robin Park',
        email: 'robin.park@old.test',
        avatar_url: null,
        provider: 'linear',
        source_id: 'e2e-robin',
      },
      slack(ids.robinSlack, 'Robin P.', photos.robin, 'T0E2E:U0ROBIN'),
    ];
    data.identity_bindings = [
      ...(data.identity_bindings ?? []),
      { member_id: alex.id, source_person_id: ids.alexSlack, via: 'slack_user_map' },
      { member_id: jamie.id, source_person_id: ids.jamieSlack, via: 'slack_user_map' },
      {
        person_id: ids.robinLinear,
        source_person_id: ids.robinSlack,
        via: 'slack_source_person_map',
      },
    ];
    await route.fulfill({ response, json: data });
  });
}
