import { assert, missing } from '../../core/errors.mjs';
import { now } from '../../core/crypto.mjs';
import { slackApi, verifySlackApp } from './api.mjs';
import { readSlackConfig, writeSlackConfig, slackAdmin } from './people.mjs';
export const slackEvents = ['created', 'updated', 'commented', 'archived', 'restored', 'deleted'];
export async function slackStatus(tx, actor, env) {
  await slackAdmin(tx, actor);
  const config = await readSlackConfig(tx, actor.workspace_id);
  const missing = ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID', 'INTEGRATIONS_WORKSPACE_ID'].filter(
    (key) => !env[key],
  );
  if (env.INTEGRATIONS_WORKSPACE_ID && env.INTEGRATIONS_WORKSPACE_ID !== actor.workspace_id)
    missing.push('WORKSPACE_BINDING');
  const people = await tx.one(
    "SELECT COUNT(*) AS count FROM source_people WHERE workspace_id=? AND provider='slack'",
    [actor.workspace_id],
  );
  const queue = await tx.all(
    "SELECT status,COUNT(*) AS count FROM outbox WHERE workspace_id=? AND provider='slack' GROUP BY status",
    [actor.workspace_id],
  );
  return {
    configured: missing.length === 0,
    connected: missing.length === 0 && config.connection?.team_id === env.SLACK_TEAM_ID,
    missing,
    connection: config.connection ?? null,
    sync: config.sync ?? null,
    people: Number(people.count),
    queue,
    stream: {
      notify: config.notify === true,
      channel_id: config.channel_id ?? '',
      channel_name: config.channel_name ?? '',
      events: config.events ?? slackEvents,
      revision: config.stream_revision ?? 0,
    },
    user_map: config.user_map ?? {},
    team_id: config.team_id ?? null,
    interactive_ready: Boolean(env.SLACK_SIGNING_SECRET),
    required_scopes: [
      'users:read',
      'users:read.email',
      'users.profile:read',
      'channels:read',
      'groups:read',
      'chat:write',
    ],
  };
}
export async function checkConnection(db, actor, env, fetcher = fetch) {
  const connection = await verifySlackApp(env, actor, fetcher);
  return db.transaction(async (tx) => {
    await tx.lock(actor.workspace_id);
    await slackAdmin(tx, actor);
    const config = await readSlackConfig(tx, actor.workspace_id);
    await writeSlackConfig(tx, actor.workspace_id, {
      ...config,
      connection: { ...connection, verified_at: now() },
    });
    return slackStatus(tx, actor, env);
  });
}
export const eligibleChannel = (channel) =>
  Boolean(
    channel &&
    /^[CG][A-Z0-9]+$/.test(channel.id ?? '') &&
    !channel.is_im &&
    !channel.is_mpim &&
    !channel.is_archived &&
    !channel.is_ext_shared &&
    !channel.is_org_shared &&
    !channel.is_shared &&
    channel.is_member === true,
  );
export async function slackChannels(env, actor, cursor = '', fetcher = fetch) {
  await verifySlackApp(env, actor, fetcher);
  const result = await slackApi(
    env,
    'conversations.list',
    {
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    },
    fetcher,
  );
  assert(
    Array.isArray(result.channels),
    502,
    'SLACK_INVALID_CHANNELS',
    'Slack returned an invalid channel list.',
  );
  return {
    channels: result.channels
      .filter(eligibleChannel)
      .map((c) => ({ id: c.id, name: c.name, is_private: c.is_private === true })),
    next_cursor: result.response_metadata?.next_cursor ?? '',
  };
}
export async function configureSlackStream(db, actor, env, input, fetcher = fetch) {
  let channel = null,
    connection = null;
  if (input.notify) {
    connection = await verifySlackApp(env, actor, fetcher);
    channel = (await slackApi(env, 'conversations.info', { channel: input.channel_id }, fetcher))
      .channel;
    assert(
      eligibleChannel(channel),
      422,
      'SLACK_CHANNEL_NOT_ALLOWED',
      'Choose a non-shared channel the Tasks bot has joined. Direct messages are not supported.',
    );
  }
  return db.transaction(async (tx) => {
    await tx.lock(actor.workspace_id);
    await slackAdmin(tx, actor);
    const current = await readSlackConfig(tx, actor.workspace_id);
    assert(
      input.revision === (current.stream_revision ?? 0),
      409,
      'SLACK_SETTINGS_CHANGED',
      'Slack settings changed. Reload before saving.',
    );
    const config = {
      ...current,
      notify: input.notify,
      channel_id: channel?.id ?? current.channel_id ?? '',
      channel_name: channel?.name ?? current.channel_name ?? '',
      events: input.events,
      stream_revision: (current.stream_revision ?? 0) + 1,
      ...(connection ? { connection: { ...connection, verified_at: now() } } : {}),
    };
    await writeSlackConfig(tx, actor.workspace_id, config);
    // Old destinations may never be rerouted to a newly selected channel.
    await tx.exec(
      "UPDATE outbox SET status='canceled',last_error='SLACK_STREAM_RECONFIGURED' WHERE workspace_id=? AND provider='slack' AND status='pending' AND payload LIKE ?",
      [actor.workspace_id, '%"slack_stream":true%'],
    );
    return slackStatus(tx, actor, env);
  });
}
export async function mapSlackUser(tx, actor, input) {
  await slackAdmin(tx, actor);
  await tx.lock(actor.workspace_id);
  const person = await tx.one(
    "SELECT source_id FROM source_people WHERE workspace_id=? AND id=? AND provider='slack'",
    [actor.workspace_id, input.person_id],
  );
  if (!person) throw missing('Slack profile');
  if (input.user_id)
    assert(
      await tx.one('SELECT user_id FROM memberships WHERE workspace_id=? AND user_id=?', [
        actor.workspace_id,
        input.user_id,
      ]),
      422,
      'INVALID_MEMBER',
      'Map only an existing Tasks member.',
    );
  const config = await readSlackConfig(tx, actor.workspace_id),
    user_map = { ...config.user_map },
    [team, user] = person.source_id.split(':');
  assert(
    config.connection?.team_id === team,
    409,
    'SLACK_TEAM_MISMATCH',
    'Reconnect the correct Slack workspace.',
  );
  if (input.user_id) user_map[user] = input.user_id;
  else delete user_map[user];
  await writeSlackConfig(tx, actor.workspace_id, { ...config, user_map });
  return { ok: true, accounts_created: 0 };
}
