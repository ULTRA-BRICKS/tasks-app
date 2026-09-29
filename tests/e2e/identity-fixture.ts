import type { Page } from '@playwright/test';
export type Person = { id: string; name: string; email: string; role: string };
const source = (id: string, name: string, email: string | null, provider: string) => ({
  id,
  name,
  email,
  avatar_url: null,
  provider,
  source_id: id,
});
/** Synthetic identities around the demo members: an email-matched Linear alias and a bound Slack
 * profile for Jamie, two Linear profiles sharing Sam's email, and a Linear OAuth app.
 * `samName` renames Sam's member record in the catalog only. */
export async function identityFixture(page: Page, { samName }: { samName?: string } = {}) {
  await page.route('**/api/v1/catalog', async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const data = await response.json();
    const jamie = data.people.find((p: Person) => p.name === 'Jamie Chen');
    const sam = data.people.find((p: Person) => p.name === 'Sam Rivera');
    if (samName) sam.name = samName;
    data.source_people = [
      ...(data.source_people ?? []),
      source('aaaaaaaa-0000-4000-8000-000000000001', 'jchen', jamie.email.toUpperCase(), 'linear'),
      source('aaaaaaaa-0000-4000-8000-000000000002', 'Jamie C.', 'jamie@home.test', 'slack'),
      source('aaaaaaaa-0000-4000-8000-000000000003', 'Sam Rivera', sam.email, 'linear'),
      source('aaaaaaaa-0000-4000-8000-000000000004', 'Sam R. (old)', sam.email, 'linear'),
      {
        ...source(
          'aaaaaaaa-0000-4000-8000-000000000005',
          'Codex',
          'x@oauthapp.linear.app',
          'linear',
        ),
        bot: true,
      },
    ];
    data.identity_bindings = [
      {
        member_id: jamie.id,
        source_person_id: 'aaaaaaaa-0000-4000-8000-000000000002',
        via: 'slack_user_map',
      },
    ];
    await route.fulfill({ response, json: data });
  });
}
