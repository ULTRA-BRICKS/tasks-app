// "Sign in with Slack" (OpenID Connect authorization-code flow) for existing workspace members.
// Spec: docs/SLACK-SIGNIN.md. It never creates accounts: the Slack email must already belong to a
// Tasks member. The result is the ordinary hashed, expiring server session of the password login.
import { createHash } from 'node:crypto';
import { AppError, assert } from '../../core/errors.mjs';
import { constantEqual, hmac, secret } from '../../core/crypto.mjs';
import { rateLimit, startSession } from './service.mjs';

const AUTHORIZE_URL = 'https://slack.com/openid/connect/authorize';
const TOKEN_URL = 'https://slack.com/api/openid.connect.token';
const TEAM_CLAIM = 'https://slack.com/team_id';
const STATE_TTL_SECONDS = 600;
export const STATE_COOKIE = 'tickets_slack_oauth';
export const CALLBACK_PATH = '/api/auth/slack/callback';

export const slackSigninConfigured = (env) =>
  Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET && env.SLACK_TEAM_ID);

const stateMac = (key, state, nonce, expires) =>
  hmac(key, `slack-signin|${state}|${nonce}|${expires}`);

/** The browser cookie binds one authorization request to the browser that started it. */
export function startSlackSignin({ env, origin, signingKey, time = Date.now() }) {
  assert(
    slackSigninConfigured(env),
    503,
    'SLACK_SIGNIN_NOT_CONFIGURED',
    'Sign in with Slack is not configured',
  );
  const state = secret(),
    nonce = secret(),
    expires = Math.floor(time / 1000) + STATE_TTL_SECONDS;
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    scope: 'openid email profile',
    client_id: env.SLACK_CLIENT_ID,
    redirect_uri: origin + CALLBACK_PATH,
    team: env.SLACK_TEAM_ID,
    state,
    nonce,
  }).toString();
  return {
    location: url.toString(),
    cookieValue: `${state}.${nonce}.${expires}.${stateMac(signingKey, state, nonce, expires)}`,
  };
}

const failure = (code) => new AppError(401, code, 'Sign in with Slack failed');

/** Returns the stored nonce when the cookie is genuine, unexpired and matches the returned state. */
function checkState({ cookieValue, state, signingKey, time = Date.now() }) {
  const [saved, nonce, expires, mac] = String(cookieValue ?? '').split('.');
  assert(saved && nonce && expires && mac, 401, 'STATE_MISSING', 'Sign in with Slack failed');
  assert(
    constantEqual(mac, stateMac(signingKey, saved, nonce, expires)) &&
      constantEqual(saved, String(state ?? '')),
    401,
    'STATE_MISMATCH',
    'Sign in with Slack failed',
  );
  assert(
    /^\d+$/.test(expires) && Number(expires) * 1000 >= time,
    401,
    'STATE_EXPIRED',
    'Sign in with Slack failed',
  );
  return nonce;
}

/** Slack's token endpoint is reached directly over TLS, so its id_token needs no signature check (OIDC Core 3.1.3.7). */
function claimsFrom(idToken) {
  const parts = typeof idToken === 'string' ? idToken.split('.') : [];
  if (parts.length !== 3) throw failure('SLACK_BAD_TOKEN');
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (claims && typeof claims === 'object') return claims;
  } catch {
    /* falls through */
  }
  throw failure('SLACK_BAD_TOKEN');
}

export async function exchangeCode({
  env,
  origin,
  code,
  nonce,
  fetcher = fetch,
  time = Date.now(),
}) {
  let body;
  try {
    const response = await fetcher(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: env.SLACK_CLIENT_ID,
        client_secret: env.SLACK_CLIENT_SECRET,
        redirect_uri: origin + CALLBACK_PATH,
      }),
      signal: AbortSignal.timeout(10000),
    });
    body = await response.json();
  } catch {
    throw new AppError(502, 'SLACK_UNREACHABLE', 'Slack could not be reached');
  }
  if (!body?.ok) throw failure('SLACK_CODE_REJECTED');
  const claims = claimsFrom(body.id_token);
  const audience = [].concat(claims.aud);
  if (
    claims.iss !== 'https://slack.com' ||
    !audience.includes(env.SLACK_CLIENT_ID) ||
    !(Number(claims.exp) * 1000 > time) ||
    !constantEqual(String(claims.nonce ?? ''), nonce)
  )
    throw failure('SLACK_BAD_TOKEN');
  if (claims[TEAM_CLAIM] !== env.SLACK_TEAM_ID) throw failure('SLACK_WRONG_TEAM');
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  if (!email || claims.email_verified !== true) throw failure('SLACK_NO_EMAIL');
  return { email };
}

/** Completes a callback: checks state, trades the code, and opens a session for an existing member only. */
export async function completeSlackSignin({
  db,
  env,
  origin,
  signingKey,
  query,
  cookieValue,
  fetcher,
  time,
}) {
  assert(
    slackSigninConfigured(env),
    503,
    'SLACK_SIGNIN_NOT_CONFIGURED',
    'Sign in with Slack is not configured',
  );
  // No per-source limiter: on the self-hosted server every visitor shares one source key, so any
  // anonymous client (who can mint a valid state at /start for free) could lock everyone out. A
  // callback needs a Slack-issued one-time code; the limiter below counts only exchanges that Slack
  // accepted, so it can be spent by a signed-in Slack user on their own email address only.
  const nonce = checkState({ cookieValue, state: query.get('state'), signingKey, time });
  if (query.get('error')) throw failure('SLACK_DENIED');
  const code = query.get('code');
  assert(code && code.length <= 512, 401, 'SLACK_CODE_MISSING', 'Sign in with Slack failed');
  const { email } = await exchangeCode({ env, origin, code, nonce, fetcher, time });
  const emailAllowed = await db.transaction(async (tx) => {
    await tx.lock('auth-rate-limit');
    return rateLimit(
      tx,
      'slack-signin-email:' + createHash('sha256').update(email).digest('hex'),
      12,
    );
  });
  assert(emailAllowed, 429, 'RATE_LIMITED', 'Too many attempts. Try again in 15 minutes.');
  return db.transaction(async (tx) => {
    const user = await tx.one('SELECT * FROM users WHERE email=?', [email]);
    if (!user) throw failure('NOT_A_MEMBER');
    await tx.lock('identity:user:' + user.id);
    const session = await startSession(tx, user, { workspaceId: env.INTEGRATIONS_WORKSPACE_ID });
    if (!session) throw failure('NOT_A_MEMBER');
    return session;
  });
}
