/**
 * Slack profile sync (docs/SLACK-PROFILES.md, UB-34): reads `users.list` with the bot token and
 * stores the names and photos of administrator-mapped Slack users as source people
 * (`provider='slack'`, `source_id='<team>:<user>'`). It runs only on an administrator's request.
 * The token is sent to Slack and nowhere else: never logged, stored, returned or put in an error.
 */
import { id, now } from '../../core/crypto.mjs';
import { AppError, assert, requirePermission } from '../../core/errors.mjs';
import { assertModule } from '../../core/modules.mjs';
import { SLACK_PROFILE_STATE, slackProfileState } from '../../core/source-people.mjs';

const USERS_LIST = 'https://slack.com/api/users.list';
const PAGE_SIZE = 200;
const MAX_PAGES = 50;
const MAX_RUNS = 20;
/** Seconds to pause when Slack answers 429 without a usable Retry-After, and the longest pause. */
const DEFAULT_RETRY_AFTER = 60;
const MAX_RETRY_AFTER = 3600;
const AUTH_ERRORS = new Set([
  'invalid_auth',
  'not_authed',
  'account_inactive',
  'token_revoked',
  'token_expired',
]);
const REQUIRED_ENV = ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID', 'INTEGRATIONS_WORKSPACE_ID'];

/** Whether this deployment can sync profiles for the workspace; reads env names, never exposes values. */
export const slackProfilesConfigured = (env, workspace) =>
  REQUIRED_ENV.every((name) => Boolean(env[name])) && env.INTEGRATIONS_WORKSPACE_ID === workspace;

const rateLimited = (seconds) =>
  new AppError(
    429,
    'SLACK_RATE_LIMITED',
    `Slack is rate limiting requests. Try again in ${seconds} seconds.`,
    { retry_after: seconds },
  );

/** Seconds from a Retry-After header (seconds or HTTP date), bounded; 60 when absent. */
function retryAfter(response) {
  const header = response.headers.get('retry-after');
  let seconds = Number(header);
  if (!header || !Number.isFinite(seconds))
    seconds = (Date.parse(header ?? '') - Date.now()) / 1000;
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(Math.ceil(seconds), MAX_RETRY_AFTER)
    : DEFAULT_RETRY_AFTER;
}

/** Maps a refused Slack answer to a Tasks error. Only Slack's plain error codes pass through. */
function slackFailure(body) {
  const code =
    typeof body?.error === 'string' && /^[a-z_]{1,64}$/.test(body.error) ? body.error : null;
  if (code === 'missing_scope') {
    const needed =
      typeof body.needed === 'string' && /^[a-z:._,]{1,200}$/.test(body.needed)
        ? body.needed
        : 'users:read';
    return new AppError(
      502,
      'SLACK_MISSING_SCOPE',
      `The Slack app lacks the ${needed} scope. Add it to the bot token scopes and reinstall the app.`,
      { needed },
    );
  }
  if (code && AUTH_ERRORS.has(code))
    return new AppError(
      502,
      'SLACK_AUTH_FAILED',
      'Slack rejected the bot token. Reinstall the Slack app and update SLACK_BOT_TOKEN.',
    );
  return new AppError(
    502,
    'SLACK_REQUEST_FAILED',
    'Slack could not list its users. Try again later.',
    code ? { slack_error: code } : undefined,
  );
}

/**
 * Pages `users.list` until every wanted Slack user ID was seen or the list ends.
 * @param {Record<string,string|undefined>} env
 * @param {typeof fetch} fetcher
 * @param {Set<string>} wanted
 */
export async function listSlackUsers(env, fetcher, wanted) {
  /** @type {Map<string, any>} */
  const users = new Map();
  const cursors = new Set();
  let cursor = '';
  for (let pages = 0; ; pages++) {
    assert(
      pages < MAX_PAGES,
      502,
      'SLACK_REQUEST_FAILED',
      'Slack returned more user pages than one sync reads.',
    );
    const url = new URL(USERS_LIST);
    url.searchParams.set('limit', String(PAGE_SIZE));
    if (cursor) url.searchParams.set('cursor', cursor);
    let response;
    try {
      response = await fetcher(url.toString(), {
        method: 'GET',
        headers: { authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      // The error text can echo request details; only the code leaves this function.
      throw new AppError(502, 'SLACK_UNREACHABLE', 'Slack could not be reached. Try again later.');
    }
    if (response.status === 429) throw rateLimited(retryAfter(response));
    const body = await response.json().catch(() => null);
    if (body?.error === 'ratelimited') throw rateLimited(retryAfter(response));
    if (!response.ok || body?.ok !== true || !Array.isArray(body.members)) throw slackFailure(body);
    // Unmapped users are neither stored nor counted: paging stops once every mapped user was seen,
    // so any count of them would depend on Slack's page order.
    for (const user of body.members)
      if (typeof user?.id === 'string' && wanted.has(user.id)) users.set(user.id, user);
    const next = body.response_metadata?.next_cursor ?? '';
    assert(
      typeof next === 'string',
      502,
      'SLACK_REQUEST_FAILED',
      'Slack sent a malformed page cursor.',
    );
    cursor = next;
    if (!cursor || users.size === wanted.size) return users;
    assert(!cursors.has(cursor), 502, 'SLACK_REQUEST_FAILED', 'Slack repeated a page cursor.');
    cursors.add(cursor);
  }
}

/** Authorizes the caller and returns the mapped Slack user IDs with their mapped person's name. */
async function syncTargets(tx, actor, env) {
  requirePermission(actor, 'admin');
  await assertModule(tx, actor.workspace_id, 'slack');
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  assert(
    !missing.length,
    503,
    'SLACK_NOT_CONFIGURED',
    `Slack profile sync needs ${missing.join(', ')} in the deployment environment.`,
  );
  assert(
    env.INTEGRATIONS_WORKSPACE_ID === actor.workspace_id,
    403,
    'WORKSPACE_NOT_CONFIGURED',
    'Slack is connected to another workspace (INTEGRATIONS_WORKSPACE_ID).',
  );
  const row = await tx.one(
    "SELECT config FROM module_settings WHERE workspace_id=? AND module='slack'",
    [actor.workspace_id],
  );
  const config = JSON.parse(row?.config ?? '{}');
  const userMap = Object.entries(config.user_map ?? {}),
    personMap = Object.entries(config.source_person_map ?? {});
  /** One query per map, however many entries it has: `id → name` for the given IDs. */
  const names = async (sql, entries) => {
    const ids = [...new Set(entries.map(([, targetId]) => targetId))];
    if (!ids.length) return new Map();
    const rows = await tx.all(sql(ids.map(() => '?').join(',')), [actor.workspace_id, ...ids]);
    return new Map(rows.map((found) => [found.id, found.name]));
  };
  const members = await names(
    (slots) =>
      `SELECT u.id,u.name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.workspace_id=? AND u.id IN (${slots})`,
    userMap,
  );
  const people = await names(
    (slots) =>
      `SELECT id,name FROM source_people WHERE workspace_id=? AND provider<>'slack' AND id IN (${slots})`,
    personMap,
  );
  /** @type {Map<string, string>} Slack user ID → current name of the mapped member or person. */
  const targets = new Map();
  for (const [slackUserId, targetId] of userMap) {
    const name = members.get(targetId);
    if (name !== undefined) targets.set(slackUserId, name);
  }
  for (const [slackUserId, targetId] of personMap) {
    const name = people.get(targetId);
    if (name !== undefined) targets.set(slackUserId, name);
  }
  return targets;
}

async function saveState(tx, workspace, state) {
  await tx.exec(
    'INSERT INTO module_settings(workspace_id,module,enabled,config) VALUES(?,?,1,?) ON CONFLICT(workspace_id,module) DO UPDATE SET config=excluded.config',
    [workspace, SLACK_PROFILE_STATE, JSON.stringify(state)],
  );
}

/** Trimmed text, at most 200 characters; empty when Slack sent nothing usable. */
const profileText = (value) => (typeof value === 'string' ? value.trim().slice(0, 200) : '');

/** The photo URL exactly as Slack returned it, when it is a plausible HTTPS URL. */
function profilePhoto(user) {
  const url = user.profile?.image_192;
  return typeof url === 'string' && url.length <= 2048 && /^https:\/\/[^\s]+$/.test(url)
    ? url
    : null;
}

/** Writes the listed Slack users in one transaction; re-authorizes and re-reads the mappings.
 * Only mappings that were requested from Slack are considered: one saved during the read
 * waits for the next sync. */
async function storeProfiles(tx, actor, env, requested, users) {
  const workspace = actor.workspace_id,
    team = env.SLACK_TEAM_ID;
  const current = await syncTargets(tx, actor, env);
  const targets = new Map([...current].filter(([slackUserId]) => requested.has(slackUserId)));
  const state = await slackProfileState(tx, workspace);
  const profiles = { ...state.profiles };
  const stored = new Map(
    (
      await tx.all(
        "SELECT id,source_id,name,avatar_url FROM source_people WHERE workspace_id=? AND provider='slack'",
        [workspace],
      )
    ).map((row) => [row.source_id, row]),
  );
  const counts = {
    mapped: targets.size,
    created: 0,
    updated: 0,
    unchanged: 0,
    deactivated: 0,
    bots: 0,
    cross_workspace: 0,
    not_found: 0,
  };
  /** @type {string[]} */
  const crossWorkspace = [],
    notFound = [];
  for (const slackUserId of [...targets.keys()].sort()) {
    const user = users.get(slackUserId);
    if (!user) {
      notFound.push(slackUserId);
      continue;
    }
    if (user.team_id !== team) {
      crossWorkspace.push(slackUserId);
      continue;
    }
    const sourceId = `${team}:${slackUserId}`;
    const name =
      profileText(user.profile?.display_name) ||
      profileText(user.profile?.real_name) ||
      profileText(user.real_name) ||
      profileText(targets.get(slackUserId));
    const photo = profilePhoto(user);
    const row = stored.get(sourceId);
    if (!row) {
      // Variant B: Slack emails are never read; the explicit mapping binds this profile.
      await tx.exec(
        "INSERT INTO source_people(id,workspace_id,provider,source_id,name,email,avatar_url,created_at) VALUES(?,?,'slack',?,?,NULL,?,?)",
        [id(), workspace, sourceId, name, photo, now()],
      );
      counts.created++;
    } else if (row.name !== name || row.avatar_url !== photo) {
      await tx.exec('UPDATE source_people SET name=?,avatar_url=? WHERE workspace_id=? AND id=?', [
        name,
        photo,
        workspace,
        row.id,
      ]);
      counts.updated++;
    } else counts.unchanged++;
    const bot = user.is_bot === true || slackUserId === 'USLACKBOT',
      deactivated = user.deleted === true;
    if (bot) counts.bots++;
    if (deactivated) counts.deactivated++;
    if (bot || deactivated)
      profiles[sourceId] = {
        ...(bot ? { bot: true } : {}),
        ...(deactivated ? { deactivated: true } : {}),
      };
    else delete profiles[sourceId];
  }
  counts.cross_workspace = crossWorkspace.length;
  counts.not_found = notFound.length;
  const syncedAt = now();
  await saveState(tx, workspace, {
    profiles,
    // A pause another sync recorded while this one read Slack still holds.
    paused_until: activePause(state),
    runs: [{ at: syncedAt, actor_id: actor.id, outcome: 'ok', counts }, ...state.runs].slice(
      0,
      MAX_RUNS,
    ),
  });
  return { synced_at: syncedAt, counts, cross_workspace: crossWorkspace, not_found: notFound };
}

/** The end of a recorded rate-limit pause that has not passed yet. */
const activePause = (state) =>
  Date.parse(state.paused_until ?? '') > Date.now() ? state.paused_until : undefined;

/** Audits a failed Slack read in its own transaction; Slack's rate limit also pauses later
 * attempts, never shortening a pause that is already longer. */
async function recordFailure(tx, actor, error) {
  requirePermission(actor, 'admin');
  const state = await slackProfileState(tx, actor.workspace_id);
  const kept = activePause(state);
  const at = now();
  await saveState(tx, actor.workspace_id, {
    ...state,
    paused_until:
      error.code === 'SLACK_RATE_LIMITED'
        ? new Date(
            Math.max(Date.parse(kept ?? '') || 0, Date.now() + error.details.retry_after * 1000),
          ).toISOString()
        : kept,
    runs: [{ at, actor_id: actor.id, outcome: error.code }, ...state.runs].slice(0, MAX_RUNS),
  });
}

/**
 * One administrator-requested sync: authorize (read transaction), read Slack (no transaction),
 * then write (one transaction under the workspace lock).
 * @param {{run:(read:boolean, fn:(tx:any, actor:any)=>Promise<any>)=>Promise<any>, env:Record<string,string|undefined>, fetcher:typeof fetch}} options
 */
export async function syncSlackProfiles({ run, env, fetcher }) {
  const { targets, pausedFor } = await run(true, async (tx, actor) => {
    const found = await syncTargets(tx, actor, env);
    const { paused_until } = await slackProfileState(tx, actor.workspace_id);
    const remaining = Math.ceil((Date.parse(paused_until ?? '') - Date.now()) / 1000);
    return { targets: found, pausedFor: remaining > 0 ? remaining : 0 };
  });
  // Refused before Slack is called: not an attempt, so it neither extends the pause nor is audited.
  if (pausedFor) throw rateLimited(pausedFor);
  const fail = async (error) => {
    if (error instanceof AppError) await run(false, (tx, actor) => recordFailure(tx, actor, error));
    throw error;
  };
  const requested = new Set(targets.keys());
  let listed = new Map();
  if (requested.size)
    try {
      listed = await listSlackUsers(env, fetcher, requested);
    } catch (error) {
      return fail(error);
    }
  return run(false, (tx, actor) => storeProfiles(tx, actor, env, requested, listed));
}

/** The last sync attempt for the Settings summary, without any environment value. */
export async function slackProfileSyncStatus(tx, workspace) {
  const [last] = (await slackProfileState(tx, workspace)).runs;
  if (!last) return null;
  const actor = await tx.one('SELECT name FROM users WHERE id=?', [last.actor_id]);
  return {
    at: last.at,
    actor_name: actor?.name ?? null,
    outcome: last.outcome,
    ...(last.counts ? { counts: last.counts } : {}),
  };
}
