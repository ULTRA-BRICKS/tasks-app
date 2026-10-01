import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
import { canonicalPeople } from '../../src/shared/lib/canonical-people.mjs';

// Synthetic credential for an in-memory database; it must never appear in any output.
const TOKEN = ['synthetic', 'slack', 'bot', 'credential'].join('-');
const SYNC = '/api/v1/integrations/slack/profiles/sync';
const ids = {
  teammate: '00000000-0000-4000-8000-000000000341',
  linearOnly: '00000000-0000-4000-8000-000000000342',
  linearBot: '00000000-0000-4000-8000-000000000343',
  otherWorkspace: '00000000-0000-4000-8000-000000000344',
  foreignPerson: '00000000-0000-4000-8000-000000000345',
  slackProfile: '00000000-0000-4000-8000-000000000346',
};
const photo = (name) => `https://avatars.slack-edge.com/2026-09-30/${name}_192.png`;
/** A users.list member as Slack returns it. */
const member = (id, profile = {}, extra = {}) => ({
  id,
  team_id: 'T1',
  name: id.toLowerCase(),
  deleted: false,
  is_bot: false,
  real_name: '',
  profile: { display_name: '', real_name: '', ...profile },
  ...extra,
});
const page = (members, next = '') => ({
  ok: true,
  members,
  response_metadata: { next_cursor: next },
});
/** Injected fetch that answers users.list calls from a queue and records each call. */
function slackApi() {
  const queue = [],
    calls = [];
  return {
    calls,
    respond: (...responses) => queue.push(...responses),
    fetch: async (url, init = {}) => {
      calls.push({
        url: String(url),
        method: init.method ?? 'GET',
        authorization: new Headers(init.headers).get('authorization'),
      });
      const next = queue.shift();
      if (!next) throw new Error('unexpected Slack call');
      if (next instanceof Error) throw next;
      if (next instanceof Response) return next;
      if (typeof next === 'function') return Response.json(await next());
      return Response.json(next);
    },
  };
}
async function setup({ env = {}, userMap, sourceMap } = {}) {
  const api = slackApi(),
    logs = [];
  const log = (...entry) => logs.push(entry);
  const f = await fixture({ SLACK_BOT_TOKEN: TOKEN, SLACK_TEAM_ID: 'T1', ...env }, undefined, {
    slackFetch: api.fetch,
    logger: { error: log, warn: log, info: log, log },
  });
  f.env.INTEGRATIONS_WORKSPACE_ID = f.init.workspace_id;
  await f.db.transaction(async (tx) => {
    await tx.exec(
      "INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,'not-a-login','2026-09-30T00:00:00.000Z')",
      [ids.teammate, 'teammate@example.test', 'Teammate'],
    );
    await tx.exec("INSERT INTO memberships(workspace_id,user_id,role) VALUES(?,?,'member')", [
      f.init.workspace_id,
      ids.teammate,
    ]);
    const source = (id, workspace, provider, sourceId, name, email) =>
      tx.exec(
        'INSERT INTO source_people(id,workspace_id,provider,source_id,name,email) VALUES(?,?,?,?,?,?)',
        [id, workspace, provider, sourceId, name, email],
      );
    await source(ids.linearOnly, f.init.workspace_id, 'linear', 'lin-1', 'Lin Only', 'lin@x.test');
    await source(
      ids.linearBot,
      f.init.workspace_id,
      'linear',
      'app-1',
      'Codex',
      'x@oauthapp.linear.app',
    );
    await tx.exec(
      "INSERT INTO workspaces(id,name,slug,created_at) VALUES(?,'Elsewhere','elsewhere','2026-09-30T00:00:00.000Z')",
      [ids.otherWorkspace],
    );
    await source(ids.foreignPerson, ids.otherWorkspace, 'linear', 'lin-9', 'Foreign', null);
  });
  const saved = await f.request('PATCH', '/api/v1/integrations/slack', {
    team_id: f.init.team_id,
    notify: false,
    user_map: userMap ?? { U1: f.init.user_id, U2: ids.teammate },
    source_person_map: sourceMap ?? { U3: ids.linearOnly },
  });
  expect(saved.status).toBe(200);
  return { f, api, logs };
}
const slackRows = (f) =>
  f.db.transaction((tx) =>
    tx.all(
      "SELECT id,source_id,name,email,avatar_url FROM source_people WHERE provider='slack' ORDER BY source_id",
    ),
  );
async function signInAs(f, role) {
  const email = `slack-${role}@example.test`,
    password = ['synthetic', role, 'login'].join('-');
  const invite = (await f.request('POST', '/api/v1/invitations', { email, role })).data;
  const accepted = await f.request('POST', '/api/auth/accept-invite', {
    token: invite.token,
    name: role,
    password,
  });
  expect(accepted.status).toBe(201);
  const login = await f.request('POST', '/api/auth/login', { email, password });
  f.setSession(login.headers.get('set-cookie').split(';')[0]);
}

test('sync pages users.list with the bot token and stores only mapped profiles, without email', async () => {
  const { f, api } = await setup();
  try {
    api.respond(
      page(
        [
          member('U1', {
            display_name: 'Owner Slack',
            real_name: 'Owner Real',
            image_192: photo('u1'),
            // Returned only with users:read.email, which the app does not have; ignored anyway.
            email: 'owner.private@slack.test',
          }),
          member('U9', { display_name: 'Not mapped', image_192: photo('u9') }),
        ],
        'cursor-2',
      ),
      page([
        member('U2', { display_name: 'Mate', image_192: photo('u2') }),
        member('U3', { display_name: 'Lin Slack', image_192: photo('u3') }),
      ]),
    );
    const synced = await f.request('POST', SYNC);
    expect(synced.status).toBe(200);
    expect(synced.data.counts).toEqual({
      mapped: 3,
      created: 3,
      updated: 0,
      unchanged: 0,
      deactivated: 0,
      bots: 0,
      cross_workspace: 0,
      not_found: 0,
    });
    expect(synced.data.cross_workspace).toEqual([]);
    expect(synced.data.not_found).toEqual([]);
    expect(Number.isNaN(Date.parse(synced.data.synced_at))).toBe(false);
    expect(api.calls).toEqual([
      {
        url: 'https://slack.com/api/users.list?limit=200',
        method: 'GET',
        authorization: 'Bearer ' + TOKEN,
      },
      {
        url: 'https://slack.com/api/users.list?limit=200&cursor=cursor-2',
        method: 'GET',
        authorization: 'Bearer ' + TOKEN,
      },
    ]);
    const rows = await slackRows(f);
    expect(rows.map(({ id: _, ...row }) => row)).toEqual([
      { source_id: 'T1:U1', name: 'Owner Slack', email: null, avatar_url: photo('u1') },
      { source_id: 'T1:U2', name: 'Mate', email: null, avatar_url: photo('u2') },
      { source_id: 'T1:U3', name: 'Lin Slack', email: null, avatar_url: photo('u3') },
    ]);
    const slackId = (sourceId) => rows.find((row) => row.source_id === sourceId)?.id;
    const catalog = (await f.request('GET', '/api/v1/catalog')).data;
    expect(catalog.identity_bindings).toEqual([
      { member_id: f.init.user_id, source_person_id: slackId('T1:U1'), via: 'slack_user_map' },
      { member_id: ids.teammate, source_person_id: slackId('T1:U2'), via: 'slack_user_map' },
      {
        person_id: ids.linearOnly,
        source_person_id: slackId('T1:U3'),
        via: 'slack_source_person_map',
      },
    ]);
    const people = canonicalPeople(
      catalog.people,
      catalog.source_people,
      catalog.identity_bindings,
    );
    const person = (id) => people.find((p) => p.aliases.includes(id));
    expect(person(f.init.user_id)).toMatchObject({
      id: f.init.user_id,
      name: 'Owner Slack',
      avatar_url: photo('u1'),
    });
    expect(person(ids.teammate)).toMatchObject({ name: 'Mate', avatar_url: photo('u2') });
    // A Linear author without a Tasks account gets the Slack name and photo through the new map.
    expect(person(ids.linearOnly)).toMatchObject({
      id: ids.linearOnly,
      name: 'Lin Slack',
      avatar_url: photo('u3'),
    });
    expect(new Set(person(ids.linearOnly)?.aliases)).toEqual(
      new Set([ids.linearOnly, slackId('T1:U3')]),
    );
    // Server-rendered names use the same projection.
    const task = (await f.create({ title: 'Linear-only work', assignee_id: ids.linearOnly })).data;
    expect((await f.request('GET', '/api/v1/issues/' + task.id)).data.assignee_name).toBe(
      'Lin Slack',
    );
    const own = (await f.create({ title: 'Own work', assignee_id: f.init.user_id })).data;
    expect((await f.request('GET', '/api/v1/issues/' + own.id)).data.assignee_name).toBe(
      'Owner Slack',
    );
  } finally {
    await f.close();
  }
});

test('empty Slack names fall back to real_name, then to the mapped person (at most 200 characters); bad photos are dropped', async () => {
  const { f, api } = await setup();
  try {
    api.respond(
      page([
        member('U1', {
          display_name: '   ',
          real_name: 'Owner Real',
          image_192: 'http://insecure.test/a.png',
        }),
        member('U2', { display_name: '', real_name: '' }, { real_name: 'Mate Top Level' }),
        member('U3', { display_name: '', real_name: ' ' }),
      ]),
    );
    const synced = await f.request('POST', SYNC);
    expect(synced.status).toBe(200);
    expect((await slackRows(f)).map((row) => [row.source_id, row.name, row.avatar_url])).toEqual([
      ['T1:U1', 'Owner Real', null],
      ['T1:U2', 'Mate Top Level', null],
      ['T1:U3', 'Lin Only', null],
    ]);
    // The mapped person's name is a fallback too, so it is held to the same 200 characters.
    await f.db.transaction((tx) =>
      tx.exec('UPDATE source_people SET name=? WHERE id=?', [
        ` ${'L'.repeat(250)} `,
        ids.linearOnly,
      ]),
    );
    api.respond(page([member('U3', { display_name: '', real_name: '' })]));
    expect((await f.request('POST', SYNC)).status).toBe(200);
    expect((await slackRows(f)).find((row) => row.source_id === 'T1:U3').name).toBe(
      'L'.repeat(200),
    );
  } finally {
    await f.close();
  }
});

test('a repeated sync is idempotent; deactivated users and bots stay stored and flagged', async () => {
  const { f, api } = await setup();
  try {
    const users = [
      member('U1', { display_name: 'Owner Slack', image_192: photo('u1') }),
      member('U2', { display_name: 'Mate', image_192: photo('u2') }),
    ];
    api.respond(page(users), page(users));
    expect((await f.request('POST', SYNC)).data.counts).toMatchObject({ created: 2, unchanged: 0 });
    const before = await slackRows(f);
    const again = await f.request('POST', SYNC);
    expect(again.data.counts).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    expect(await slackRows(f)).toEqual(before);
    api.respond(
      page([
        member('U1', { display_name: 'Owner Renamed', image_192: photo('u1b') }),
        member('U2', { display_name: 'Mate', image_192: photo('u2') }, { deleted: true }),
        member('U3', { display_name: 'Helper Bot', image_192: photo('bot') }, { is_bot: true }),
      ]),
    );
    const third = await f.request('POST', SYNC);
    expect(third.data.counts).toMatchObject({
      created: 1,
      updated: 1,
      unchanged: 1,
      deactivated: 1,
      bots: 1,
    });
    const rows = await slackRows(f);
    expect(rows.map((row) => [row.source_id, row.name])).toEqual([
      ['T1:U1', 'Owner Renamed'],
      ['T1:U2', 'Mate'],
      ['T1:U3', 'Helper Bot'],
    ]);
    const catalog = (await f.request('GET', '/api/v1/catalog')).data;
    const bot = catalog.source_people.find((p) => p.source_id === 'T1:U3');
    expect(bot.bot).toBe(true);
    // A bot never joins a human: the imported person keeps its own name and no Slack alias.
    const people = canonicalPeople(
      catalog.people,
      catalog.source_people,
      catalog.identity_bindings,
    );
    expect(people.find((p) => p.aliases.includes(ids.linearOnly))?.aliases).toEqual([
      ids.linearOnly,
    ]);
    // The deactivated user keeps its row, its binding and its flag.
    expect(people.find((p) => p.id === ids.teammate)?.name).toBe('Mate');
    const state = await f.db.transaction((tx) =>
      tx.one(
        "SELECT config FROM module_settings WHERE workspace_id=? AND module='slack-profiles'",
        [f.init.workspace_id],
      ),
    );
    expect(JSON.parse(state.config).profiles).toEqual({
      'T1:U2': { deactivated: true },
      'T1:U3': { bot: true },
    });
  } finally {
    await f.close();
  }
});

test('sync rejects users of another Slack workspace and reports mapped users Slack did not return', async () => {
  const { f, api } = await setup();
  try {
    api.respond(
      page([
        member('U1', { display_name: 'Guest from T2', image_192: photo('u1') }, { team_id: 'T2' }),
        member('U3', { display_name: 'Lin Slack' }),
      ]),
    );
    const synced = await f.request('POST', SYNC);
    expect(synced.status).toBe(200);
    expect(synced.data.cross_workspace).toEqual(['U1']);
    expect(synced.data.not_found).toEqual(['U2']);
    expect(synced.data.counts).toMatchObject({ created: 1, cross_workspace: 1, not_found: 1 });
    expect((await slackRows(f)).map((row) => row.source_id)).toEqual(['T1:U3']);
  } finally {
    await f.close();
  }
});

test('Slack failures map to their own codes, honor Retry-After and never expose the token', async () => {
  const { f, api, logs } = await setup();
  try {
    const outcomes = [];
    const run = async (response) => {
      api.respond(response);
      const result = await f.request('POST', SYNC);
      outcomes.push(JSON.stringify(result));
      return result;
    };
    const scope = await run({
      ok: false,
      error: 'missing_scope',
      needed: 'users:read',
      provided: 'chat:write',
    });
    expect(scope.status).toBe(502);
    expect(scope.data.error.code).toBe('SLACK_MISSING_SCOPE');
    expect(scope.data.error.details).toEqual({ needed: 'users:read' });
    const auth = await run({ ok: false, error: 'invalid_auth' });
    expect([auth.status, auth.data.error.code]).toEqual([502, 'SLACK_AUTH_FAILED']);
    const other = await run({ ok: false, error: 'invalid_cursor' });
    expect(other.data.error).toMatchObject({
      code: 'SLACK_REQUEST_FAILED',
      details: { slack_error: 'invalid_cursor' },
    });
    const malformed = await run(new Response('<html>' + TOKEN + '</html>', { status: 200 }));
    expect(malformed.data.error.code).toBe('SLACK_REQUEST_FAILED');
    const offline = await run(new TypeError('fetch failed for ' + TOKEN));
    expect([offline.status, offline.data.error.code]).toEqual([502, 'SLACK_UNREACHABLE']);
    const limited = await run(
      new Response(JSON.stringify({ ok: false, error: 'ratelimited' }), {
        status: 429,
        headers: { 'retry-after': '30' },
      }),
    );
    expect(limited.status).toBe(429);
    expect(limited.data.error.code).toBe('SLACK_RATE_LIMITED');
    expect(limited.data.error.details).toEqual({ retry_after: 30 });
    const pausedUntil = async () =>
      JSON.parse(
        (
          await f.db.transaction((tx) =>
            tx.one(
              "SELECT config FROM module_settings WHERE workspace_id=? AND module='slack-profiles'",
              [f.init.workspace_id],
            ),
          )
        ).config,
      ).paused_until;
    const pause = await pausedUntil();
    // Until the pause ends, a sync is refused without calling Slack; refusing neither extends the
    // pause nor adds an attempt to the audit trail.
    const callsBefore = api.calls.length;
    for (let attempt = 0; attempt < 3; attempt++) {
      const paused = await f.request('POST', SYNC);
      outcomes.push(JSON.stringify(paused));
      expect(paused.status).toBe(429);
      expect(paused.data.error.code).toBe('SLACK_RATE_LIMITED');
      expect(paused.data.error.details.retry_after).toBeGreaterThan(0);
      expect(paused.data.error.details.retry_after).toBeLessThanOrEqual(30);
    }
    expect(api.calls.length).toBe(callsBefore);
    expect(await pausedUntil()).toBe(pause);
    await f.db.transaction(async (tx) => {
      const row = await tx.one(
        "SELECT config FROM module_settings WHERE workspace_id=? AND module='slack-profiles'",
        [f.init.workspace_id],
      );
      const state = JSON.parse(row.config);
      state.paused_until = new Date(Date.now() - 1000).toISOString();
      await tx.exec(
        "UPDATE module_settings SET config=? WHERE workspace_id=? AND module='slack-profiles'",
        [JSON.stringify(state), f.init.workspace_id],
      );
    });
    const resumed = await run(page([member('U1', { display_name: 'Owner Slack' })]));
    expect(resumed.status).toBe(200);
    const status = await f.request('GET', '/api/v1/integrations');
    outcomes.push(JSON.stringify(status));
    expect(status.data.slack.profile_sync).toMatchObject({ outcome: 'ok', actor_name: 'Owner' });
    const state = await f.db.transaction((tx) =>
      tx.one(
        "SELECT config FROM module_settings WHERE workspace_id=? AND module='slack-profiles'",
        [f.init.workspace_id],
      ),
    );
    expect(JSON.parse(state.config).runs.map((entry) => entry.outcome)).toEqual([
      'ok',
      'SLACK_RATE_LIMITED',
      'SLACK_UNREACHABLE',
      'SLACK_REQUEST_FAILED',
      'SLACK_REQUEST_FAILED',
      'SLACK_AUTH_FAILED',
      'SLACK_MISSING_SCOPE',
    ]);
    const stored = await f.db.transaction((tx) => tx.all('SELECT config FROM module_settings'));
    for (const text of [...outcomes, JSON.stringify(stored), JSON.stringify(logs)])
      expect(text).not.toContain(TOKEN);
  } finally {
    await f.close();
  }
});

test('a malformed page cursor fails the sync instead of reporting later users as not found', async () => {
  const { f, api } = await setup();
  try {
    for (const next_cursor of [123, { page: 2 }]) {
      api.respond({
        ok: true,
        members: [member('U1', { display_name: 'Owner Slack' })],
        response_metadata: { next_cursor },
      });
      const synced = await f.request('POST', SYNC);
      expect([synced.status, synced.data.error?.code]).toEqual([502, 'SLACK_REQUEST_FAILED']);
    }
    expect(await slackRows(f)).toEqual([]);
  } finally {
    await f.close();
  }
});

test('a mapping saved while the sync reads Slack waits for the next sync instead of reading as not found', async () => {
  const { f, api } = await setup();
  try {
    const added = '00000000-0000-4000-8000-000000000347';
    await f.db.transaction((tx) =>
      tx.exec(
        "INSERT INTO source_people(id,workspace_id,provider,source_id,name,email) VALUES(?,?,'linear','lin-2','Lin Two',NULL)",
        [added, f.init.workspace_id],
      ),
    );
    const users = [
      member('U1', { display_name: 'Owner Slack' }),
      member('U2', { display_name: 'Mate Slack' }),
      member('U3', { display_name: 'Lin Slack' }),
    ];
    api.respond(async () => {
      const saved = await f.request('PATCH', '/api/v1/integrations/slack', {
        team_id: f.init.team_id,
        notify: false,
        user_map: { U1: f.init.user_id, U2: ids.teammate },
        source_person_map: { U3: ids.linearOnly, U4: added },
      });
      expect(saved.status).toBe(200);
      return page(users);
    });
    const first = await f.request('POST', SYNC);
    expect(first.status).toBe(200);
    expect(first.data.not_found).toEqual([]);
    expect(first.data.counts).toMatchObject({ mapped: 3, created: 3, not_found: 0 });
    api.respond(page([...users, member('U4', { display_name: 'Lin Two Slack' })]));
    const next = await f.request('POST', SYNC);
    expect(next.data.counts).toMatchObject({ mapped: 4, created: 1, unchanged: 3, not_found: 0 });
    expect((await slackRows(f)).map((row) => row.source_id)).toEqual([
      'T1:U1',
      'T1:U2',
      'T1:U3',
      'T1:U4',
    ]);
  } finally {
    await f.close();
  }
});

test('a sync that succeeds while another sync recorded a Slack rate limit keeps that pause', async () => {
  const { f, api } = await setup();
  try {
    const pause = new Date(Date.now() + 60_000).toISOString();
    // While this sync reads Slack, a concurrent sync records a 429 pause.
    api.respond(async () => {
      await f.db.transaction((tx) =>
        tx.exec(
          "INSERT INTO module_settings(workspace_id,module,enabled,config) VALUES(?,'slack-profiles',1,?)",
          [f.init.workspace_id, JSON.stringify({ paused_until: pause, runs: [] })],
        ),
      );
      return page([member('U1', { display_name: 'Owner Slack' })]);
    });
    expect((await f.request('POST', SYNC)).status).toBe(200);
    const calls = api.calls.length;
    const refused = await f.request('POST', SYNC);
    expect([refused.status, refused.data.error.code]).toEqual([429, 'SLACK_RATE_LIMITED']);
    expect(api.calls.length).toBe(calls);
  } finally {
    await f.close();
  }
});

test('only administrators can run the sync; configuration problems are explicit', async () => {
  const { f, api } = await setup();
  try {
    const status = await f.request('GET', '/api/v1/integrations');
    expect(status.data.slack.profiles_configured).toBe(true);
    expect(status.data.slack.profile_sync).toBeNull();
    expect(JSON.stringify(status.data)).not.toContain(TOKEN);
    f.env.SLACK_BOT_TOKEN = '';
    const missing = await f.request('POST', SYNC);
    expect([missing.status, missing.data.error.code]).toEqual([503, 'SLACK_NOT_CONFIGURED']);
    expect(missing.data.error.message).toContain('SLACK_BOT_TOKEN');
    expect((await f.request('GET', '/api/v1/integrations')).data.slack.profiles_configured).toBe(
      false,
    );
    f.env.SLACK_BOT_TOKEN = TOKEN;
    f.env.INTEGRATIONS_WORKSPACE_ID = ids.otherWorkspace;
    const elsewhere = await f.request('POST', SYNC);
    expect([elsewhere.status, elsewhere.data.error.code]).toEqual([
      403,
      'WORKSPACE_NOT_CONFIGURED',
    ]);
    f.env.INTEGRATIONS_WORKSPACE_ID = f.init.workspace_id;
    expect((await f.request('PATCH', '/api/v1/modules/slack', { enabled: false })).status).toBe(
      200,
    );
    const disabled = await f.request('POST', SYNC);
    expect([disabled.status, disabled.data.error.code]).toEqual([409, 'MODULE_DISABLED']);
    expect((await f.request('PATCH', '/api/v1/modules/slack', { enabled: true })).status).toBe(200);
    // The private state row is not a module an administrator can toggle.
    expect(
      (await f.request('PATCH', '/api/v1/modules/slack-profiles', { enabled: false })).status,
    ).toBe(404);
    const owner = f.session;
    for (const role of ['member', 'viewer']) {
      f.setSession(owner);
      await signInAs(f, role);
      const denied = await f.request('POST', SYNC);
      // Sessions of members and viewers carry no admin scope at all.
      expect([denied.status, denied.data.error.code]).toEqual([403, 'INSUFFICIENT_SCOPE']);
    }
    expect(api.calls).toEqual([]);
    f.setSession(owner);
    // Without any mapping there is nothing to ask Slack for.
    const saved = await f.request('PATCH', '/api/v1/integrations/slack', {
      team_id: f.init.team_id,
      notify: false,
      user_map: {},
    });
    expect(saved.status).toBe(200);
    const empty = await f.request('POST', SYNC);
    expect(empty.status).toBe(200);
    expect(empty.data.counts).toMatchObject({ mapped: 0, created: 0 });
    expect(api.calls).toEqual([]);
  } finally {
    await f.close();
  }
});

test('imported-person mappings accept only existing non-Slack people of this workspace', async () => {
  const { f } = await setup({ userMap: {}, sourceMap: {} });
  try {
    await f.db.transaction((tx) =>
      tx.exec(
        "INSERT INTO source_people(id,workspace_id,provider,source_id,name) VALUES(?,?,'slack','T1:U7','Slack row')",
        [ids.slackProfile, f.init.workspace_id],
      ),
    );
    const save = (input) =>
      f.request('PATCH', '/api/v1/integrations/slack', {
        team_id: f.init.team_id,
        notify: false,
        user_map: {},
        ...input,
      });
    const refused = async (input, code) => {
      const result = await save(input);
      expect([result.status, result.data.error?.code]).toEqual([422, code]);
    };
    await refused({ source_person_map: { U3: ids.foreignPerson } }, 'INVALID_SOURCE_PERSON');
    await refused(
      { source_person_map: { U3: '00000000-0000-4000-8000-000000000399' } },
      'INVALID_SOURCE_PERSON',
    );
    await refused({ source_person_map: { U3: ids.slackProfile } }, 'INVALID_SOURCE_PERSON');
    // A member ID is not an imported person.
    await refused({ source_person_map: { U3: f.init.user_id } }, 'INVALID_SOURCE_PERSON');
    await refused({ source_person_map: { U3: ids.linearBot } }, 'BOT_MAPPING');
    await refused(
      { user_map: { U3: f.init.user_id }, source_person_map: { U3: ids.linearOnly } },
      'AMBIGUOUS_MAPPING',
    );
    await refused(
      { source_person_map: { U3: ids.linearOnly, U4: ids.linearOnly } },
      'AMBIGUOUS_MAPPING',
    );
    const accepted = await save({
      user_map: { U1: f.init.user_id },
      source_person_map: { U3: ids.linearOnly },
    });
    expect(accepted.status).toBe(200);
    expect(accepted.data.config.source_person_map).toEqual({ U3: ids.linearOnly });
  } finally {
    await f.close();
  }
});
