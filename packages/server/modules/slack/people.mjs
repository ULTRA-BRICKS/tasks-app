import { createHash } from 'node:crypto';
import { assert, requirePermission, missing } from '../../core/errors.mjs';
import { assertModule } from '../../core/modules.mjs';
import { id, now } from '../../core/crypto.mjs';
import { slackApi, verifySlackApp, assertSlackWorkspace } from './api.mjs';
const text = (value, max = 512) => (typeof value === 'string' ? value.slice(0, max) : '');
export function slackPersonId(workspace, team, user) {
  const hex = createHash('sha256')
    .update(JSON.stringify(['tasks-slack-person-v1', workspace, team, user]))
    .digest('hex');
  return (
    hex.slice(0, 8) +
    '-' +
    hex.slice(8, 12) +
    '-5' +
    hex.slice(13, 16) +
    '-a' +
    hex.slice(17, 20) +
    '-' +
    hex.slice(20, 32)
  );
}
export function normalizeSlackUser(user, team) {
  assert(
    user && typeof user.id === 'string' && /^[UW][A-Z0-9]+$/.test(user.id),
    502,
    'SLACK_INVALID_USER',
    'Slack returned an invalid user.',
  );
  assert(
    !user.team_id || user.team_id === team,
    403,
    'SLACK_FOREIGN_USER',
    'A user from a different Slack workspace cannot be synchronized.',
  );
  const p = user.profile && typeof user.profile === 'object' ? user.profile : {};
  const avatar = [p.image_192, p.image_512, p.image_72].find(
    (value) => typeof value === 'string' && /^https:\/\//.test(value),
  );
  return {
    slack_id: user.id,
    name: text(p.display_name || p.real_name || user.real_name || user.name || user.id, 200),
    email:
      typeof p.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)
        ? p.email.slice(0, 254).toLowerCase()
        : null,
    avatar_url: avatar ? text(avatar, 2048) : null,
    deleted: user.deleted === true,
    bot: user.is_bot === true || user.id === 'USLACKBOT',
  };
}
export async function readSlackConfig(tx, workspace) {
  const row = await tx.one(
    "SELECT config FROM module_settings WHERE workspace_id=? AND module='slack'",
    [workspace],
  );
  try {
    const parsed = JSON.parse(row?.config ?? '{}');
    return parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
export async function writeSlackConfig(tx, workspace, config) {
  await tx.exec(
    "INSERT INTO module_settings(workspace_id,module,enabled,config) VALUES(?,'slack',1,?) ON CONFLICT(workspace_id,module) DO UPDATE SET config=excluded.config",
    [workspace, JSON.stringify(config)],
  );
}
export async function slackAdmin(tx, actor) {
  requirePermission(actor, 'admin');
  await assertModule(tx, actor.workspace_id, 'slack');
  const member = await tx.one('SELECT role FROM memberships WHERE workspace_id=? AND user_id=?', [
    actor.workspace_id,
    actor.id,
  ]);
  assert(
    member && ['owner', 'admin'].includes(member.role),
    403,
    'FORBIDDEN',
    'Slack setup requires a current workspace administrator.',
  );
}
export async function syncSlackPeople(db, actor, env, input = {}, fetcher = fetch) {
  const connection = await verifySlackApp(env, actor, fetcher);
  const before = await db.transaction(
    async (tx) => {
      await slackAdmin(tx, actor);
      return readSlackConfig(tx, actor.workspace_id);
    },
    { readOnly: true },
  );
  const cursor = input.cursor || '';
  if (cursor)
    assert(
      before.sync?.run_id === input.run_id &&
        before.sync.next_cursor === cursor &&
        !before.sync.complete,
      409,
      'SLACK_SYNC_CHANGED',
      'This sync cursor is no longer current. Restart directory sync.',
    );
  const response = await slackApi(
    env,
    'users.list',
    { limit: 200, include_locale: true, ...(cursor ? { cursor } : {}) },
    fetcher,
  );
  assert(
    Array.isArray(response.members) && response.members.length <= 1000,
    502,
    'SLACK_INVALID_DIRECTORY',
    'Slack returned an invalid directory page.',
  );
  const people = response.members.map((user) => normalizeSlackUser(user, connection.team_id));
  const next = response.response_metadata?.next_cursor || '';
  assert(
    typeof next === 'string' && next.length <= 2048 && (!next || next !== cursor),
    502,
    'SLACK_INVALID_CURSOR',
    'Slack returned a repeated or invalid cursor.',
  );
  return db.transaction(async (tx) => {
    await tx.lock(actor.workspace_id);
    await slackAdmin(tx, actor);
    const current = await readSlackConfig(tx, actor.workspace_id);
    assert(
      JSON.stringify(current.sync) === JSON.stringify(before.sync),
      409,
      'SLACK_SYNC_CHANGED',
      'Another directory sync advanced. Reload its current progress.',
    );
    for (const person of people)
      await tx.exec(
        "INSERT INTO source_people(id,workspace_id,provider,source_id,name,email,avatar_url,created_at) VALUES(?,?,'slack',?,?,?,?,?) ON CONFLICT(workspace_id,provider,source_id) DO UPDATE SET name=excluded.name,email=excluded.email,avatar_url=excluded.avatar_url",
        [
          slackPersonId(actor.workspace_id, connection.team_id, person.slack_id),
          actor.workspace_id,
          connection.team_id + ':' + person.slack_id,
          person.name,
          person.email,
          person.avatar_url,
          now(),
        ],
      );
    const progress = {
      run_id: cursor ? input.run_id : id(),
      next_cursor: next,
      complete: !next,
      count: (cursor ? before.sync.count : 0) + people.length,
      updated_at: now(),
    };
    await writeSlackConfig(tx, actor.workspace_id, {
      ...current,
      connection: { ...connection, verified_at: now() },
      sync: progress,
    });
    return { ...progress, records_on_page: people.length, accounts_created: 0 };
  });
}
export async function slackDirectory(tx, actor) {
  await slackAdmin(tx, actor);
  const people = await tx.all(
    "SELECT p.id,p.source_id,p.name,p.email,p.avatar_url,(SELECT m.user_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=p.workspace_id AND LOWER(u.email)=LOWER(p.email) LIMIT 1) AS suggested_member_id FROM source_people p WHERE p.workspace_id=? AND p.provider='slack' ORDER BY p.name,p.id LIMIT 10000",
    [actor.workspace_id],
  );
  return people.map((p) => ({
    ...p,
    slack_team_id: p.source_id.split(':')[0],
    slack_id: p.source_id.split(':')[1],
  }));
}
export async function slackProfile(db, actor, env, personId, fetcher = fetch) {
  assertSlackWorkspace(env, actor);
  const person = await db.transaction(
    async (tx) => {
      await slackAdmin(tx, actor);
      return tx.one(
        "SELECT source_id FROM source_people WHERE workspace_id=? AND id=? AND provider='slack'",
        [actor.workspace_id, personId],
      );
    },
    { readOnly: true },
  );
  if (!person) throw missing('Slack person');
  const [team, user] = person.source_id.split(':');
  assert(
    team === env.SLACK_TEAM_ID,
    403,
    'SLACK_TEAM_MISMATCH',
    'This profile belongs to another Slack workspace.',
  );
  await verifySlackApp(env, actor, fetcher);
  const response = await slackApi(env, 'users.info', { user, include_locale: true }, fetcher);
  const normalized = normalizeSlackUser(response.user, team);
  assert(
    normalized.slack_id === user,
    502,
    'SLACK_PROFILE_MISMATCH',
    'Slack returned a different user profile.',
  );
  let profile = response.user.profile ?? {},
    warning = null;
  try {
    const details = await slackApi(
      env,
      'users.profile.get',
      { user, include_labels: true },
      fetcher,
    );
    profile = { ...profile, ...details.profile };
  } catch (error) {
    if (error.code === 'SLACK_MISSING_SCOPE' || error.code === 'SLACK_ACCESS_DENIED')
      warning = 'Custom profile details are restricted by Slack permissions.';
    else throw error;
  }
  const u = response.user;
  return {
    ...normalized,
    team_id: team,
    title: text(profile.title),
    phone: text(profile.phone),
    pronouns: text(profile.pronouns),
    first_name: text(profile.first_name),
    last_name: text(profile.last_name),
    real_name: text(profile.real_name),
    display_name: text(profile.display_name),
    timezone: text(u.tz),
    timezone_label: text(u.tz_label),
    timezone_offset: Number(u.tz_offset) || 0,
    locale: text(u.locale),
    is_admin: u.is_admin === true,
    is_owner: u.is_owner === true,
    is_guest: u.is_restricted === true,
    is_single_channel_guest: u.is_ultra_restricted === true,
    status_text: text(profile.status_text),
    status_emoji: text(profile.status_emoji),
    status_expiration: Number(profile.status_expiration) || 0,
    profile,
    warning,
    fetched_at: now(),
    access_note: 'Profile metadata only; no Tasks account or permission is created.',
  };
}
