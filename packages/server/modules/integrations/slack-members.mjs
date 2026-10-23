// Operator tool: turns the humans of the connected Slack workspace into Tasks members, maps them to
// their Slack accounts and pulls Slack names and photos (docs/SLACK-SIGNIN.md, "Adding members").
// It only uses the app's own services: invite/acceptInvite for accounts, setIntegrationConfig for
// the Slack mapping and syncSlackProfiles for names and photos. Reading emails needs the bot scope
// users:read.email, which this tool uses and the running app never does.
import { secret } from '../../core/crypto.mjs';
import { AppError, assert } from '../../core/errors.mjs';
import { acceptInvite, invite, sessionScopes } from '../identity/service.mjs';
import { assertModule } from '../../core/modules.mjs';
import { setIntegrationConfig } from './service.mjs';
import { syncSlackProfiles } from './slack-profiles.mjs';

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** Classifies every Slack account; only active, non-bot accounts with an email can become members. */
export async function listSlackPeople(env, fetcher = fetch) {
  assert(env.SLACK_BOT_TOKEN, 503, 'SLACK_NOT_CONFIGURED', 'SLACK_BOT_TOKEN is not set');
  const people = { humans: [], bots: [], deactivated: [], noEmail: [], otherTeam: [] };
  const seen = new Set();
  let cursor = '';
  for (let page = 0; page < 50; page++) {
    const response = await fetcher(
      'https://slack.com/api/users.list?limit=200' +
        (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
      {
        headers: { authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
        signal: AbortSignal.timeout(10000),
      },
    );
    const body = await response.json().catch(() => null);
    if (!body?.ok)
      throw new AppError(
        502,
        'SLACK_REQUEST_FAILED',
        `Slack refused users.list: ${/^[a-z_]{1,64}$/.test(body?.error) ? body.error : 'unknown'}`,
        { needed: body?.needed },
      );
    for (const member of body.members ?? []) {
      const profile = member.profile ?? {};
      const row = {
        slack_id: member.id,
        email: text(profile.email).toLowerCase(),
        name: text(profile.real_name) || text(member.real_name) || text(profile.display_name),
        guest: Boolean(member.is_restricted || member.is_ultra_restricted),
        has_photo: Boolean(profile.image_192),
      };
      if (seen.has(row.slack_id)) continue;
      seen.add(row.slack_id);
      // The profile sync requires the same exact team, so a member without team_id is not ours.
      if (member.team_id !== env.SLACK_TEAM_ID) people.otherTeam.push(row);
      else if (member.is_bot || member.id === 'USLACKBOT') people.bots.push(row);
      else if (member.deleted) people.deactivated.push(row);
      else if (!row.email) people.noEmail.push(row);
      else people.humans.push(row);
    }
    cursor = text(body.response_metadata?.next_cursor);
    if (!cursor) return people;
  }
  throw new AppError(502, 'SLACK_REQUEST_FAILED', 'Slack returned too many pages');
}

/**
 * Plans (dry run) or performs (apply) the member import. Existing members are never modified;
 * accounts get an unknown random password because they sign in with Slack.
 * @returns the lists of created, existing and failed emails plus the sync result.
 */
export async function importSlackMembers({
  db,
  env,
  fetcher = fetch,
  apply = false,
  role = 'member',
  includeGuests = false,
}) {
  for (const name of ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID', 'INTEGRATIONS_WORKSPACE_ID'])
    assert(env[name], 503, 'SLACK_NOT_CONFIGURED', `${name} is not set; nothing was changed`);
  const people = await listSlackPeople(env, fetcher);
  const candidates = people.humans.filter((p) => includeGuests || !p.guest);
  const owner = await db.transaction((tx) =>
    tx.one(
      "SELECT m.workspace_id,m.user_id FROM memberships m WHERE m.role='owner' AND m.workspace_id=? ORDER BY m.user_id LIMIT 1",
      [env.INTEGRATIONS_WORKSPACE_ID],
    ),
  );
  assert(owner, 409, 'NO_OWNER', 'INTEGRATIONS_WORKSPACE_ID has no owner');
  const actor = {
    id: owner.user_id,
    workspace_id: owner.workspace_id,
    role: 'owner',
    scopes: sessionScopes('owner'),
  };
  if (apply)
    await db.transaction(async (tx) => {
      // Everything the mapping step needs is checked before the first account is created.
      await assertModule(tx, actor.workspace_id, 'slack');
      const row = await tx.one(
        "SELECT config FROM module_settings WHERE workspace_id=? AND module='slack'",
        [actor.workspace_id],
      );
      const configured = JSON.parse(row?.config ?? '{}').team_id;
      assert(
        await tx.one(
          configured
            ? 'SELECT id FROM teams WHERE workspace_id=? AND id=?'
            : 'SELECT id FROM teams WHERE workspace_id=? LIMIT 1',
          configured ? [actor.workspace_id, configured] : [actor.workspace_id],
        ),
        409,
        'NO_TEAM',
        'The configured (or first) team of the workspace does not exist, so the Slack mapping cannot be saved',
      );
    });
  const report = {
    slack: Object.fromEntries(Object.entries(people).map(([k, v]) => [k, v.length])),
    guests_skipped: people.humans.length - candidates.length,
    existing: [],
    created: [],
    failed: [],
    other_workspace_accounts: [],
    duplicate_emails: [],
    mapped: 0,
    sync: null,
  };
  const userIds = new Map();
  // One read for every account: who is already a member here, who has an account elsewhere.
  const accounts = await db.transaction((tx) =>
    tx.all(
      'SELECT u.id,u.email,(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.workspace_id=?) AS member FROM users u',
      [actor.workspace_id],
    ),
  );
  const byEmail = new Map(accounts.map((account) => [account.email, account]));
  const handled = new Set();
  for (const person of candidates) {
    // Two Slack accounts can carry one email; the first one wins and the other is reported.
    if (handled.has(person.email)) {
      report.duplicate_emails.push(person.email);
      continue;
    }
    handled.add(person.email);
    const account = byEmail.get(person.email);
    // An account that exists without a membership here needs its own password to join (acceptInvite
    // refuses to reset it), so an operator adds it by a normal invitation instead.
    if (account && !account.member) {
      report.other_workspace_accounts.push(person.email);
      continue;
    }
    const existing = account;
    if (existing) {
      report.existing.push(person.email);
      userIds.set(person.slack_id, existing.id);
      continue;
    }
    if (!apply) {
      report.created.push(person.email);
      continue;
    }
    try {
      const invitation = await db.transaction((tx) =>
        invite(tx, actor, { email: person.email, role }),
      );
      try {
        await acceptInvite(db, {
          token: invitation.token,
          name: (person.name || person.email.split('@')[0]).slice(0, 100),
          password: secret(),
        });
      } catch (error) {
        // The unused invitation must not stay live: nobody ever receives its token.
        await db.transaction((tx) =>
          tx.exec('DELETE FROM invitations WHERE id=? AND used_at IS NULL', [invitation.id]),
        );
        throw error;
      }
      const created = await db.transaction((tx) =>
        tx.one('SELECT id FROM users WHERE email=?', [person.email]),
      );
      userIds.set(person.slack_id, created.id);
      report.created.push(person.email);
    } catch (error) {
      report.failed.push({ email: person.email, code: error.code ?? 'ERROR' });
    }
  }
  if (!apply) return report;
  const mapped = await db.transaction(async (tx) => {
    await tx.lock(actor.workspace_id);
    const row = await tx.one(
      "SELECT config FROM module_settings WHERE workspace_id=? AND module='slack'",
      [actor.workspace_id],
    );
    const config = JSON.parse(row?.config ?? '{}');
    config.team_id ||= (
      await tx.one('SELECT id FROM teams WHERE workspace_id=? ORDER BY key LIMIT 1', [
        actor.workspace_id,
      ])
    )?.id;
    // Another Slack account may already map to the same member; keep it, never overwrite.
    const taken = new Set(Object.values(config.user_map ?? {}));
    config.user_map = { ...config.user_map };
    for (const [slackId, userId] of userIds)
      if (
        !Object.hasOwn(config.user_map, slackId) &&
        !Object.hasOwn(config.source_person_map ?? {}, slackId) &&
        !taken.has(userId)
      ) {
        config.user_map[slackId] = userId;
        taken.add(userId);
      }
    await setIntegrationConfig(tx, actor, 'slack', config);
    return Object.keys(config.user_map).length;
  });
  report.mapped = mapped;
  const run = (read, fn) =>
    db.transaction(
      async (tx) => {
        if (!read) await tx.lock(actor.workspace_id);
        return fn(tx, actor);
      },
      { readOnly: read },
    );
  report.sync = await syncSlackProfiles({ run, env, fetcher });
  return report;
}
