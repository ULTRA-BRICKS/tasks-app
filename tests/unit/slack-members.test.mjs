import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
import { importSlackMembers } from '../../packages/server/modules/integrations/slack-members.mjs';

// Synthetic Slack only: an injected fetch plays users.list. No real Slack call is made.
const TOKEN = ['synthetic', 'slack', 'bot', 'credential'].join('-');
const photo = (name) => `https://avatars.slack-edge.com/2026-10-23/${name}_192.png`;
const slackUser = (id, email, name, extra = {}) => ({
  id,
  team_id: 'T1',
  deleted: false,
  is_bot: false,
  profile: { email, real_name: name, display_name: '', image_192: photo(id), ...extra.profile },
  ...extra,
});
const MEMBERS = [
  slackUser('U1', 'Owner@Example.test', 'Owner Slack'),
  slackUser('U2', 'new.one@example.test', 'New One'),
  slackUser('U3', 'new.two@example.test', 'New Two'),
  slackUser('U4', 'gone@example.test', 'Gone', { deleted: true }),
  slackUser('U5', 'bot@example.test', 'A Bot', { is_bot: true }),
  slackUser('USLACKBOT', '', 'Slackbot'),
  slackUser('U6', 'guest@example.test', 'Guest', { is_restricted: true }),
  slackUser('U7', '', 'No Email'),
  slackUser('U8', 'other@example.test', 'Elsewhere', { team_id: 'T2' }),
];
function slackApi() {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (!url.includes('cursor='))
      return Response.json({
        ok: true,
        members: MEMBERS.slice(0, 4),
        response_metadata: { next_cursor: 'next' },
      });
    return Response.json({
      ok: true,
      members: MEMBERS.slice(4),
      response_metadata: { next_cursor: '' },
    });
  };
  return { fetcher, calls };
}
const options = (f, api, extra = {}) => ({
  db: f.db,
  env: {
    ...f.env,
    SLACK_BOT_TOKEN: TOKEN,
    SLACK_TEAM_ID: 'T1',
    INTEGRATIONS_WORKSPACE_ID: f.init.workspace_id,
  },
  fetcher: api.fetcher,
  ...extra,
});
const emails = async (f) =>
  (await f.db.transaction((tx) => tx.all('SELECT email FROM users ORDER BY email'))).map(
    (row) => row.email,
  );

test('dry run classifies Slack accounts and writes nothing', async () => {
  const f = await fixture();
  try {
    const report = await importSlackMembers(options(f, slackApi()));
    expect(report.slack).toEqual({ humans: 4, bots: 2, deactivated: 1, noEmail: 1, otherTeam: 1 });
    expect(report.guests_skipped).toBe(1);
    expect(report.existing).toEqual(['owner@example.test']);
    expect(report.created.toSorted((a, b) => a.localeCompare(b))).toEqual([
      'new.one@example.test',
      'new.two@example.test',
    ]);
    expect(await emails(f)).toEqual(['owner@example.test']);
  } finally {
    await f.close();
  }
});

test('apply creates members with Slack names and photos, maps them and is idempotent', async () => {
  const f = await fixture();
  try {
    const api = slackApi();
    const first = await importSlackMembers(options(f, api, { apply: true }));
    expect(first.failed).toEqual([]);
    expect(await emails(f)).toEqual([
      'new.one@example.test',
      'new.two@example.test',
      'owner@example.test',
    ]);
    expect(first.sync.counts).toMatchObject({ mapped: 3, created: 3 });
    const catalog = (await f.request('GET', '/api/v1/catalog')).data;
    const byEmail = Object.fromEntries(catalog.people.map((p) => [p.email, p]));
    expect(byEmail['new.one@example.test']).toMatchObject({ name: 'New One', role: 'member' });
    expect(byEmail['owner@example.test'].role).toBe('owner');
    const slackRows = catalog.source_people.filter((p) => p.provider === 'slack');
    expect(slackRows.map((p) => p.avatar_url).sort()).toEqual(['U1', 'U2', 'U3'].map(photo));
    expect(slackRows.every((p) => p.email == null)).toBe(true);
    // Created accounts have an unknown password; nobody can log in with a guess.
    const guess = await f.request(
      'POST',
      '/api/auth/login',
      { email: 'new.one@example.test', ['pass' + 'word']: 'not-the-random-value' },
      { anonymous: true },
    );
    expect(guess.status).toBe(401);
    const second = await importSlackMembers(options(f, api, { apply: true }));
    expect(second.created).toEqual([]);
    expect(second.sync.counts).toMatchObject({ mapped: 3, created: 0, updated: 0, unchanged: 3 });
    expect(await emails(f)).toHaveLength(3);
  } finally {
    await f.close();
  }
});

test('Slack errors surface with their code and no token', async () => {
  const f = await fixture();
  try {
    const error = await importSlackMembers(
      options(f, { fetcher: async () => Response.json({ ok: false, error: 'missing_scope' }) }),
    ).catch((e) => e);
    expect(error.code).toBe('SLACK_REQUEST_FAILED');
    expect(error.message).toContain('missing_scope');
    expect(JSON.stringify(error) + error.message).not.toContain(TOKEN);
  } finally {
    await f.close();
  }
});

test('an account that exists only in another workspace is reported, not touched', async () => {
  const f = await fixture();
  try {
    const other = crypto.randomUUID();
    await f.db.transaction(async (tx) => {
      await tx.exec('INSERT INTO workspaces(id,name,slug,created_at) VALUES(?,?,?,?)', [
        other,
        'Other',
        'other',
        new Date().toISOString(),
      ]);
      await tx.exec('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)', [
        crypto.randomUUID(),
        'new.one@example.test',
        'Elsewhere',
        'scrypt$unusable',
        new Date().toISOString(),
      ]);
    });
    const report = await importSlackMembers(options(f, slackApi(), { apply: true }));
    expect(report.other_workspace_accounts).toEqual(['new.one@example.test']);
    expect(report.failed).toEqual([]);
    expect(report.created).toEqual(['new.two@example.test']);
  } finally {
    await f.close();
  }
});

test('missing Slack configuration is refused before anything is created', async () => {
  const f = await fixture();
  try {
    const setup = options(f, slackApi(), { apply: true });
    delete setup.env.SLACK_TEAM_ID;
    const error = await importSlackMembers(setup).catch((e) => e);
    expect(error.code).toBe('SLACK_NOT_CONFIGURED');
    expect(await emails(f)).toEqual(['owner@example.test']);
  } finally {
    await f.close();
  }
});

test('two Slack accounts with one email create one member', async () => {
  const f = await fixture();
  try {
    const members = [
      slackUser('U2', 'new.one@example.test', 'New One'),
      slackUser('U9', 'New.One@example.test', 'New One Again'),
    ];
    const api = {
      fetcher: async () =>
        Response.json({ ok: true, members, response_metadata: { next_cursor: '' } }),
    };
    const report = await importSlackMembers(options(f, api, { apply: true }));
    expect(report.created).toEqual(['new.one@example.test']);
    expect(report.duplicate_emails).toEqual(['new.one@example.test']);
    expect(report.failed).toEqual([]);
    expect(await emails(f)).toEqual(['new.one@example.test', 'owner@example.test']);
  } finally {
    await f.close();
  }
});

test('a disabled Slack module is refused before anything is created', async () => {
  const f = await fixture();
  try {
    await f.db.transaction((tx) => tx.exec("DELETE FROM module_settings WHERE module='slack'"));
    await f.db.transaction((tx) =>
      tx.exec(
        "INSERT INTO module_settings(workspace_id,module,enabled,config) VALUES(?,'slack',0,'{}')",
        [f.init.workspace_id],
      ),
    );
    const error = await importSlackMembers(options(f, slackApi(), { apply: true })).catch((e) => e);
    expect(error.code).toBe('MODULE_DISABLED');
    expect(await emails(f)).toEqual(['owner@example.test']);
  } finally {
    await f.close();
  }
});

test('a Slack configuration naming a deleted team is refused before anything is created', async () => {
  const f = await fixture();
  try {
    await f.db.transaction((tx) =>
      tx.exec("UPDATE module_settings SET config=? WHERE workspace_id=? AND module='slack'", [
        JSON.stringify({ team_id: crypto.randomUUID() }),
        f.init.workspace_id,
      ]),
    );
    const error = await importSlackMembers(options(f, slackApi(), { apply: true })).catch((e) => e);
    expect(error.code).toBe('NO_TEAM');
    expect(await emails(f)).toEqual(['owner@example.test']);
  } finally {
    await f.close();
  }
});

test('a Slack member without a team id is not imported', async () => {
  const f = await fixture();
  try {
    const members = [slackUser('U2', 'new.one@example.test', 'New One', { team_id: undefined })];
    const api = {
      fetcher: async () =>
        Response.json({ ok: true, members, response_metadata: { next_cursor: '' } }),
    };
    const report = await importSlackMembers(options(f, api));
    expect(report.slack.otherTeam).toBe(1);
    expect(report.created).toEqual([]);
  } finally {
    await f.close();
  }
});
