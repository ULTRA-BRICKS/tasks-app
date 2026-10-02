import { AppError, assert } from '../../core/errors.mjs';
const readMethods = new Set([
  'auth.test',
  'users.list',
  'users.info',
  'users.profile.get',
  'team.profile.get',
  'conversations.list',
  'conversations.info',
]);
const writeMethods = new Set(['chat.postMessage', 'chat.update', 'chat.postEphemeral']);
export class SlackError extends AppError {
  constructor(code, { retryAfter = 0, uncertain = false, status = 502 } = {}) {
    super(
      status,
      code,
      code === 'SLACK_RATE_LIMITED'
        ? 'Slack is rate-limiting requests. Try again after the indicated delay.'
        : 'Slack could not complete this operation. Check connection permissions and try again.',
      retryAfter ? { retry_after: retryAfter } : undefined,
    );
    this.retryAfter = retryAfter;
    this.uncertain = uncertain;
  }
}
export async function slackApi(env, method, data = {}, fetcher = fetch) {
  assert(
    readMethods.has(method) || writeMethods.has(method),
    422,
    'SLACK_METHOD_NOT_ALLOWED',
    'Unsupported Slack operation',
  );
  assert(
    env.SLACK_BOT_TOKEN,
    503,
    'SLACK_NOT_CONFIGURED',
    'The Tasks Slack app is not connected. A server-side bot token is required.',
  );
  const sending = writeMethods.has(method),
    url = new URL('https://slack.com/api/' + method);
  if (!sending)
    for (const [key, value] of Object.entries(data))
      if (value !== undefined) url.searchParams.set(key, String(value));
  let response;
  try {
    response = await fetcher(url.href, {
      method: sending ? 'POST' : 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: {
        authorization: 'Bearer ' + env.SLACK_BOT_TOKEN,
        ...(sending ? { 'content-type': 'application/json' } : {}),
      },
      ...(sending ? { body: JSON.stringify(data) } : {}),
    });
  } catch {
    throw new SlackError(sending ? 'SLACK_DELIVERY_UNCONFIRMED' : 'SLACK_NETWORK', {
      uncertain: sending,
    });
  }
  if (response.status === 429) {
    const raw = Number(response.headers.get('retry-after'));
    throw new SlackError('SLACK_RATE_LIMITED', {
      retryAfter: Number.isFinite(raw) && raw > 0 ? Math.max(1, raw) : 60,
      status: 429,
    });
  }
  if (!response.ok)
    throw new SlackError('SLACK_HTTP_' + response.status, {
      uncertain: sending && response.status >= 500,
    });
  const parts = [];
  let size = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new SlackError('SLACK_INVALID_RESPONSE', { uncertain: sending });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new Error('limit');
      }
      parts.push(value);
    }
  } catch {
    throw new SlackError('SLACK_INVALID_RESPONSE', { uncertain: sending });
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch {
    throw new SlackError('SLACK_INVALID_RESPONSE', { uncertain: sending });
  }
  if (body?.ok !== true) {
    const safe = new Set([
      'missing_scope',
      'invalid_auth',
      'token_revoked',
      'account_inactive',
      'not_in_channel',
      'channel_not_found',
      'user_not_found',
      'access_denied',
      'ratelimited',
    ]);
    const error = safe.has(body?.error) ? body.error.toUpperCase() : 'API_ERROR';
    throw new SlackError('SLACK_' + error, { retryAfter: error === 'RATELIMITED' ? 60 : 0 });
  }
  return {
    ...body,
    granted_scopes: (response.headers.get('x-oauth-scopes') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
export function assertSlackWorkspace(env, actor) {
  assert(
    env.INTEGRATIONS_WORKSPACE_ID && env.INTEGRATIONS_WORKSPACE_ID === actor.workspace_id,
    503,
    'SLACK_WORKSPACE_NOT_CONFIGURED',
    'Configure the Tasks workspace for this Slack installation.',
  );
  assert(
    /^T[A-Z0-9]+$/.test(env.SLACK_TEAM_ID ?? ''),
    503,
    'SLACK_TEAM_NOT_CONFIGURED',
    'Configure the Slack workspace ID.',
  );
}
export async function verifySlackApp(env, actor, fetcher = fetch) {
  assertSlackWorkspace(env, actor);
  const result = await slackApi(env, 'auth.test', {}, fetcher);
  assert(
    result.team_id === env.SLACK_TEAM_ID && typeof result.user_id === 'string',
    403,
    'SLACK_TEAM_MISMATCH',
    'The bot belongs to a different Slack workspace.',
  );
  assert(
    typeof result.bot_id === 'string' && /^B[A-Z0-9]+$/.test(result.bot_id),
    403,
    'SLACK_BOT_REQUIRED',
    'Connect the Tasks bot installation, not a personal Slack token.',
  );
  return {
    team_id: result.team_id,
    team_name: String(result.team ?? '').slice(0, 160),
    bot_user_id: result.user_id,
    scopes: result.granted_scopes,
  };
}
