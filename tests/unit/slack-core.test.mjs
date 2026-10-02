import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
import { slackApi } from '../../packages/server/modules/slack/api.mjs';
import {
  syncSlackPeople,
  slackProfile,
  slackDirectory,
  readSlackConfig,
} from '../../packages/server/modules/slack/people.mjs';
import {
  configureSlackStream,
  mapSlackUser,
  slackStatus,
} from '../../packages/server/modules/slack/settings.mjs';
import {
  slackMessage,
  enqueueSlackActivity,
} from '../../packages/server/modules/slack/messages.mjs';
async function setup(fn) {
  const f = await fixture();
  const actor = {
    id: f.init.user_id,
    workspace_id: f.init.workspace_id,
    role: 'owner',
    scopes: ['read', 'write', 'admin'],
  };
  const env = {
    ...f.env,
    SLACK_BOT_TOKEN: 'synthetic-slack-token',
    SLACK_TEAM_ID: 'T123',
    INTEGRATIONS_WORKSPACE_ID: actor.workspace_id,
  };
  try {
    await fn(f, actor, env);
  } finally {
    await f.close();
  }
}
const auth = { ok: true, team_id: 'T123', team: 'Test Slack', user_id: 'UBOT', bot_id: 'B123' };
function fakeSlack(handlers) {
  const calls = [];
  const fetcher = async (url, options) => {
    const u = new URL(url),
      method = u.pathname.split('/').at(-1);
    calls.push({ method, query: Object.fromEntries(u.searchParams), options });
    expect(u.origin).toBe('https://slack.com');
    expect(options.redirect).toBe('error');
    const handler = handlers[method];
    const result = handler ? await handler(u, options) : method === 'auth.test' ? auth : null;
    if (!result) throw new Error('Unexpected Slack method ' + method);
    return result instanceof Response
      ? result
      : Response.json(result, {
          headers: {
            'x-oauth-scopes':
              'users:read,users:read.email,users.profile:read,channels:read,groups:read,chat:write',
          },
        });
  };
  return { fetcher, calls };
}
const member = (id, name, email) => ({
  id,
  team_id: 'T123',
  real_name: name,
  tz: 'Europe/Belgrade',
  profile: {
    display_name: name,
    email,
    image_192: 'https://avatars.slack-edge.com/test.png',
    title: 'Engineer',
    phone: '+381 test',
  },
});
test('cursor sync preserves people, never creates logins, and resumes without name-based matching', () =>
  setup(async (f, actor, env) => {
    const slack = fakeSlack({
      'users.list': (u) =>
        u.searchParams.has('cursor')
          ? {
              ok: true,
              members: [member('U222', 'Second', 'two@example.test')],
              response_metadata: { next_cursor: '' },
            }
          : {
              ok: true,
              members: [member('U111', 'Owner', 'owner@example.test')],
              response_metadata: { next_cursor: 'page2' },
            },
    });
    const first = await syncSlackPeople(f.db, actor, env, {}, slack.fetcher);
    expect(first.complete).toBe(false);
    expect(first.count).toBe(1);
    const second = await syncSlackPeople(
      f.db,
      actor,
      env,
      { cursor: first.next_cursor, run_id: first.run_id },
      slack.fetcher,
    );
    expect(second.complete).toBe(true);
    expect(second.count).toBe(2);
    const rows = await f.db.transaction((tx) => slackDirectory(tx, actor));
    expect(rows).toHaveLength(2);
    expect(rows[0].suggested_member_id).toBe(actor.id);
    expect((await f.db.transaction((tx) => tx.one('SELECT COUNT(*) AS n FROM users'))).n).toBe(1);
    expect(
      (await f.db.transaction((tx) => tx.one('SELECT COUNT(*) AS n FROM memberships'))).n,
    ).toBe(1);
    await syncSlackPeople(f.db, actor, env, {}, slack.fetcher);
    expect((await f.db.transaction((tx) => slackDirectory(tx, actor))).length).toBe(2);
  }));
test('wrong Slack team fails before source changes; private profile fields need current admin', () =>
  setup(async (f, actor, env) => {
    const wrong = fakeSlack({ 'auth.test': () => ({ ...auth, team_id: 'TOTHER' }) });
    await expect(syncSlackPeople(f.db, actor, env, {}, wrong.fetcher)).rejects.toHaveProperty(
      'code',
      'SLACK_TEAM_MISMATCH',
    );
    expect((await f.db.transaction((tx) => slackDirectory(tx, actor))).length).toBe(0);
    await expect(
      f.db.transaction((tx) =>
        slackDirectory(tx, { ...actor, role: 'member', scopes: ['read', 'write'] }),
      ),
    ).rejects.toHaveProperty('status', 403);
  }));
test('rich Slack profile returns available contact/custom metadata and restricted fields are explicit', () =>
  setup(async (f, actor, env) => {
    const slack = fakeSlack({
      'users.list': () => ({ ok: true, members: [member('U111', 'Alice', 'alice@example.test')] }),
      'users.info': () => ({
        ok: true,
        user: { ...member('U111', 'Alice', 'alice@example.test'), deleted: true },
      }),
      'users.profile.get': () => ({
        ok: true,
        profile: {
          title: 'Designer',
          phone: 'private phone',
          pronouns: 'she/her',
          fields: { X: { value: 'Design', label: 'Department' } },
        },
      }),
    });
    await syncSlackPeople(f.db, actor, env, {}, slack.fetcher);
    const [person] = await f.db.transaction((tx) => slackDirectory(tx, actor));
    const result = await slackProfile(f.db, actor, env, person.id, slack.fetcher);
    expect(result.title).toBe('Designer');
    expect(result.deleted).toBe(true);
    expect(result.profile.fields.X.value).toBe('Design');
    const restricted = fakeSlack({
      'users.info': () => ({ ok: true, user: member('U111', 'Alice', 'alice@example.test') }),
      'users.profile.get': () => ({ ok: false, error: 'missing_scope' }),
    });
    expect((await slackProfile(f.db, actor, env, person.id, restricted.fetcher)).warning).toContain(
      'restricted',
    );
  }));
test('partial sync failure leaves the cursor resumable and never treats absence as deletion', () =>
  setup(async (f, actor, env) => {
    const slack = fakeSlack({
      'users.list': () => ({
        ok: true,
        members: [member('U111', 'Alice', 'alice@example.test')],
        response_metadata: { next_cursor: 'next' },
      }),
    });
    const first = await syncSlackPeople(f.db, actor, env, {}, slack.fetcher);
    const limited = fakeSlack({
      'users.list': () =>
        new Response('rate limited', { status: 429, headers: { 'Retry-After': '87' } }),
    });
    await expect(
      syncSlackPeople(f.db, actor, env, { cursor: 'next', run_id: first.run_id }, limited.fetcher),
    ).rejects.toHaveProperty('retryAfter', 87);
    expect(
      (await f.db.transaction((tx) => readSlackConfig(tx, actor.workspace_id))).sync.next_cursor,
    ).toBe('next');
    expect((await f.db.transaction((tx) => slackDirectory(tx, actor))).length).toBe(1);
  }));
test('only joined non-shared channels qualify and stale setting edits are rejected', () =>
  setup(async (f, actor, env) => {
    const channel = { id: 'C123', name: 'task-updates', is_member: true };
    const good = fakeSlack({ 'conversations.info': () => ({ ok: true, channel }) });
    const initial = await configureSlackStream(
      f.db,
      actor,
      env,
      { notify: true, channel_id: 'C123', events: ['created', 'updated'], revision: 0 },
      good.fetcher,
    );
    expect(initial.stream.notify).toBe(true);
    expect(initial.stream.channel_id).toBe('C123');
    await expect(
      configureSlackStream(
        f.db,
        actor,
        env,
        { notify: false, events: ['created'], revision: 0 },
        good.fetcher,
      ),
    ).rejects.toHaveProperty('status', 409);
    for (const unsafe of [
      { ...channel, id: 'D123', is_im: true },
      { ...channel, is_ext_shared: true },
      { ...channel, is_member: false },
    ]) {
      const denied = fakeSlack({ 'conversations.info': () => ({ ok: true, channel: unsafe }) });
      await expect(
        configureSlackStream(
          f.db,
          actor,
          env,
          { notify: true, channel_id: unsafe.id, events: ['created'], revision: 1 },
          denied.fetcher,
        ),
      ).rejects.toHaveProperty('code', 'SLACK_CHANNEL_NOT_ALLOWED');
    }
  }));
test('Slack mapping is explicit and only permits existing members', () =>
  setup(async (f, actor, env) => {
    const slack = fakeSlack({
      'users.list': () => ({ ok: true, members: [member('U111', 'Owner', 'owner@example.test')] }),
    });
    await syncSlackPeople(f.db, actor, env, {}, slack.fetcher);
    const [person] = await f.db.transaction((tx) => slackDirectory(tx, actor));
    expect(
      (await f.db.transaction((tx) => readSlackConfig(tx, actor.workspace_id))).user_map,
    ).toBeUndefined();
    await expect(
      f.db.transaction((tx) =>
        mapSlackUser(tx, actor, { person_id: person.id, user_id: 'not-a-member' }),
      ),
    ).rejects.toHaveProperty('code', 'INVALID_MEMBER');
    await f.db.transaction((tx) =>
      mapSlackUser(tx, actor, { person_id: person.id, user_id: actor.id }),
    );
    expect(
      (await f.db.transaction((tx) => readSlackConfig(tx, actor.workspace_id))).user_map.U111,
    ).toBe(actor.id);
  }));
test('cards preserve update context, use no mass mentions and keep stable event identity', () => {
  const job = {
    id: 'event-id',
    event: 'updated',
    payload: JSON.stringify({
      issue_id: 'issue-id',
      key: 'HYP-1',
      title: '<!channel> <@USER> & test',
      actor: '<!here>',
      channel_id: 'C123',
      status: 'In progress',
      priority: 2,
      changed_fields: ['status_id'],
    }),
  };
  const a = slackMessage(job, 'https://example.test'),
    b = slackMessage(job, 'https://example.test');
  expect(a).toEqual(b);
  expect(a.client_msg_id).toBe('event-id');
  expect(a.text).not.toContain('<!');
  expect(a.text).not.toContain('<@');
  expect(a.blocks.some((block) => block.type === 'actions')).toBe(true);
  expect(a.unfurl_links).toBe(false);
});
