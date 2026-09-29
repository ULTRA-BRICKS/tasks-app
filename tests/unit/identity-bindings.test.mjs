import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
import {
  identityInventory,
  loadIdentityInputs,
} from '../../packages/server/core/source-people.mjs';
import { canonicalPeople } from '../../src/shared/lib/canonical-people.mjs';
const ids = {
  member: '00000000-0000-4000-8000-000000000291',
  linear: '00000000-0000-4000-8000-000000000292',
  slack: '00000000-0000-4000-8000-000000000293',
  teamOne: '00000000-0000-4000-8000-000000000294',
  teamTwo: '00000000-0000-4000-8000-000000000295',
  bot: '00000000-0000-4000-8000-000000000296',
};
/** Synthetic identities only: two accounts, a Linear alias and bot, and Slack profiles. */
async function seed(f) {
  await f.db.transaction(async (tx) => {
    await tx.exec(
      "INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,'not-a-login','2026-09-29T00:00:00.000Z')",
      [ids.member, 'teammate@example.test', 'Teammate'],
    );
    await tx.exec("INSERT INTO memberships(workspace_id,user_id,role) VALUES(?,?,'viewer')", [
      f.init.workspace_id,
      ids.member,
    ]);
    const source = (id, provider, sourceId, name, email) =>
      tx.exec(
        'INSERT INTO source_people(id,workspace_id,provider,source_id,name,email) VALUES(?,?,?,?,?,?)',
        [id, f.init.workspace_id, provider, sourceId, name, email],
      );
    await source(ids.linear, 'linear', 'linear-owner', 'Owner in Linear', 'OWNER@example.test');
    await source(ids.bot, 'linear', 'linear-app', 'Codex', 'x@oauthapp.linear.app');
    await source(ids.slack, 'slack', 'T1:U1', 'Owner in Slack', 'owner.private@example.test');
    // One Slack user ID under two Slack teams: a mapping to it is ambiguous.
    await source(ids.teamOne, 'slack', 'T1:U3', 'Teammate in Slack', null);
    await source(ids.teamTwo, 'slack', 'T2:U3', 'Stranger in Slack', null);
  });
  const config = await f.request('PATCH', '/api/v1/integrations/slack', {
    team_id: f.init.team_id,
    notify: false,
    user_map: { U1: f.init.user_id, U2: ids.member, U3: ids.member },
  });
  expect(config.status).toBe(200);
}
test('catalog applies only unambiguous Slack mappings of an enabled Slack module', async () => {
  const f = await fixture();
  try {
    await seed(f);
    const catalog = (await f.request('GET', '/api/v1/catalog')).data;
    expect(catalog.identity_bindings).toEqual([
      { member_id: f.init.user_id, source_person_id: ids.slack, via: 'slack_user_map' },
    ]);
    const people = canonicalPeople(
      catalog.people,
      catalog.source_people,
      catalog.identity_bindings,
    );
    const owner = people.find((person) => person.id === f.init.user_id);
    expect(new Set(owner?.aliases)).toEqual(new Set([f.init.user_id, ids.linear, ids.slack]));
    for (const id of [ids.teamOne, ids.teamTwo, ids.bot, ids.member])
      expect(people.find((person) => person.aliases.includes(id))?.aliases).toEqual([id]);
    expect(catalog.source_people.find((person) => person.id === ids.bot)?.bot).toBe(true);
    expect((await f.request('PATCH', '/api/v1/modules/slack', { enabled: false })).status).toBe(
      200,
    );
    expect((await f.request('GET', '/api/v1/catalog')).data.identity_bindings).toEqual([]);
  } finally {
    await f.close();
  }
});
test('server names and assignee filters use the canonical person across aliases', async () => {
  const f = await fixture();
  try {
    await seed(f);
    const aliasTask = (await f.create({ title: 'Assigned in Linear', assignee_id: ids.linear }))
      .data;
    const memberTask = (await f.create({ title: 'Assigned here', assignee_id: f.init.user_id }))
      .data;
    const botTask = (await f.create({ title: 'Assigned to an app', assignee_id: ids.bot })).data;
    await f.db.transaction(async (tx) => {
      await tx.exec(
        "INSERT INTO comments(id,workspace_id,issue_id,author_id,author_source_id,body,created_at,updated_at) VALUES('00000000-0000-4000-8000-000000000297',?,?,?,?,'Imported comment','2026-09-29T00:00:00.000Z','2026-09-29T00:00:00.000Z')",
        [f.init.workspace_id, aliasTask.id, f.init.user_id, ids.linear],
      );
      await tx.exec(
        "INSERT INTO activity(id,workspace_id,issue_id,actor_id,actor_source_id,action,data,created_at) VALUES('00000000-0000-4000-8000-000000000298',?,?,?,?,'linear_imported_change',?,'2026-09-29T00:00:01.000Z')",
        [
          f.init.workspace_id,
          aliasTask.id,
          f.init.user_id,
          ids.linear,
          JSON.stringify({ fromAssigneeId: null, toAssigneeId: 'linear-owner' }),
        ],
      );
    });
    const name = 'Owner in Slack'; // Slack presentation of the member, its Linear alias and bound profile.
    expect((await f.request('GET', '/api/v1/issues/' + aliasTask.id)).data.assignee_name).toBe(
      name,
    );
    const list = (query) =>
      f.request('GET', '/api/v1/issues?' + new URLSearchParams(query)).then((r) => r.data.data);
    const titles = async (query) => (await list(query)).map((issue) => issue.title).sort();
    const all = await list({});
    expect(all.find((issue) => issue.id === aliasTask.id)?.assignee_name).toBe(name);
    expect(all.find((issue) => issue.id === botTask.id)?.assignee_name).toBe('Codex');
    for (const person of [f.init.user_id, ids.linear, ids.slack, 'me'])
      expect(await titles({ assignee_id: person })).toEqual([
        'Assigned here',
        'Assigned in Linear',
      ]);
    expect(await titles({ assignee_id: ids.bot })).toEqual(['Assigned to an app']);
    expect(await titles({ assignee_id: ids.member })).toEqual([]);
    expect((await f.request('GET', '/api/v1/catalog')).data.counts.mine).toBe(2);
    const details = (await f.request('GET', '/api/v1/issues/' + aliasTask.id)).data;
    expect(details.comments.find((c) => c.body === 'Imported comment')?.author_name).toBe(name);
    const imported = details.activity.find((a) => a.action === 'linear_imported_change');
    expect(imported?.actor_name).toBe(name);
    expect(imported?.summary).toBe(`changed assignee: Unassigned → ${name}`);
    const posted = await f.request('POST', '/api/v1/issues/' + aliasTask.id + '/comments', {
      body: 'Native comment',
    });
    expect(posted.status).toBe(201);
    expect(posted.data.author_name).toBe(name);
    expect(memberTask.assignee_id).toBe(f.init.user_id);
  } finally {
    await f.close();
  }
});
test('catalog projection leaves account, role and history counts unchanged', async () => {
  const f = await fixture();
  try {
    await seed(f);
    const assigned = await f.create({ title: 'Imported attribution', assignee_id: ids.linear });
    expect(assigned.status).toBe(201);
    expect(
      (
        await f.request('POST', '/api/v1/issues/' + assigned.data.id + '/comments', {
          body: 'History that must keep its author',
        })
      ).status,
    ).toBe(201);
    const snapshot = () =>
      f.db.transaction(async (tx) => ({
        users: await tx.all('SELECT id,email,name FROM users ORDER BY id'),
        memberships: await tx.all(
          'SELECT workspace_id,user_id,role FROM memberships ORDER BY workspace_id,user_id',
        ),
        source_people: await tx.all(
          'SELECT id,provider,source_id,name,email FROM source_people ORDER BY id',
        ),
        issues: await tx.all(
          'SELECT id,assignee_id,assignee_source_id,creator_id,creator_source_id,version FROM issues ORDER BY id',
        ),
        comments: await tx.all('SELECT id,author_id,author_source_id FROM comments ORDER BY id'),
        activity: await tx.all('SELECT id,actor_id,actor_source_id FROM activity ORDER BY id'),
        module_settings: await tx.all(
          'SELECT module,enabled,config FROM module_settings ORDER BY module',
        ),
      }));
    const before = await snapshot();
    expect(before.users).toHaveLength(2);
    expect(before.source_people).toHaveLength(5);
    expect(before.activity.length).toBeGreaterThan(0);
    const catalog = (await f.request('GET', '/api/v1/catalog')).data;
    await f.request('GET', '/api/v1/issues?assignee_id=me');
    await f.request('GET', '/api/v1/issues/' + assigned.data.id);
    const report = identityInventory(
      await f.db.transaction((tx) => loadIdentityInputs(tx, f.init.workspace_id)),
    );
    const people = canonicalPeople(
      catalog.people,
      catalog.source_people,
      catalog.identity_bindings,
    );
    // Seven profiles present as five people, while every stored row stays exactly as it was.
    expect(people).toHaveLength(5);
    expect(report.counts).toMatchObject({ members: 2, sources: 5, canonical_people: 5 });
    expect(await snapshot()).toEqual(before);
    const issue = (await f.request('GET', '/api/v1/issues/' + assigned.data.id)).data;
    expect(issue.assignee_id).toBe(ids.linear);
  } finally {
    await f.close();
  }
});
test('inventory reports IDs, normalized emails, mapping status and conflicts from fixtures', () => {
  const report = identityInventory({
    workspace_id: 'workspace-1',
    members: [
      { id: 'ultra', name: 'Ultra', email: ' Ultra@Example.test ', role: 'owner' },
      { id: 'danny', name: 'Danny', email: 'danny@example.test', role: 'member' },
    ],
    sources: [
      {
        id: 'danny-a',
        name: 'Danny',
        email: 'danny@example.test',
        provider: 'linear',
        source_id: 'a',
      },
      {
        id: 'danny-b',
        name: 'Danny',
        email: 'DANNY@example.test',
        provider: 'linear',
        source_id: 'b',
      },
      { id: 'ultra-slack', name: 'Ultra', email: null, provider: 'slack', source_id: 'T1:U1' },
      {
        id: 'bot',
        name: 'CI',
        email: 'ultra@example.test',
        provider: 'slack',
        source_id: 'T1:B1',
        bot: true,
      },
      { id: 'twin-1', name: 'Twin', email: null, provider: 'slack', source_id: 'T1:U4' },
      { id: 'twin-2', name: 'Twin', email: null, provider: 'slack', source_id: 'T2:U4' },
    ],
    slack: {
      enabled: true,
      userMap: { U1: 'ultra', U2: 'former-member', U3: 'danny', U4: 'danny' },
    },
  });
  expect(report.workspace_id).toBe('workspace-1');
  const entry = (slack_user_id, member_id, source_person_id, status) => ({
    via: 'slack_user_map',
    slack_user_id,
    member_id,
    source_person_id,
    status,
  });
  expect(report.bindings).toEqual([
    entry('U1', 'ultra', 'ultra-slack', 'applied'),
    entry('U2', 'former-member', null, 'unknown_member'),
    entry('U3', 'danny', null, 'no_source_profile'),
    entry('U4', 'danny', null, 'ambiguous_source_profile'),
  ]);
  expect(report.profiles).toContainEqual({
    id: 'ultra',
    provider: 'tasks',
    source_id: null,
    role: 'owner',
    email: 'ultra@example.test',
    bot: false,
    canonical_id: 'ultra',
  });
  expect(report.profiles).toContainEqual(
    expect.objectContaining({ id: 'ultra-slack', canonical_id: 'ultra' }),
  );
  expect(report.profiles).toContainEqual(
    expect.objectContaining({ id: 'bot', bot: true, canonical_id: 'bot' }),
  );
  expect(report.emails).toEqual([
    {
      email: 'danny@example.test',
      ids: ['danny', 'danny-a', 'danny-b'],
      providers: ['linear', 'tasks'],
      status: 'conflict',
    },
    {
      email: 'ultra@example.test',
      ids: ['bot', 'ultra'],
      providers: ['slack', 'tasks'],
      status: 'separate',
    },
  ]);
  expect(report.conflicts).toMatchObject([
    { kind: 'same_provider_email', email: 'danny@example.test', providers: ['linear'] },
  ]);
  expect(report.counts).toEqual({
    members: 2,
    sources: 6,
    providers: { linear: 2, slack: 4, tasks: 2 },
    applied_bindings: 1,
    canonical_people: 7,
    conflicts: 1,
  });
  expect(
    identityInventory({
      workspace_id: 'workspace-1',
      members: [{ id: 'ultra', name: 'Ultra', email: null, role: 'owner' }],
      sources: [],
      slack: { enabled: false, userMap: { U1: 'ultra' } },
    }).bindings.map((binding) => binding.status),
  ).toEqual(['module_disabled']);
});
