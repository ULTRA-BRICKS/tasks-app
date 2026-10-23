import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
import { createServer } from 'node:http';
import {
  completeSlackSignin,
  exchangeCode,
  startSlackSignin,
} from '../../packages/server/modules/identity/slack-signin.mjs';
import { nodeHandler } from '../../packages/server/node-adapter.mjs';
import { slackSigninMessage } from '../../src/pages/auth/slack-signin-message';

// Synthetic Slack only: an injected fetch plays openid.connect.token. No real Slack call is made.
const CLIENT_KEY = 'SLACK_CLIENT_' + 'SECRET';
const SLACK = {
  SLACK_CLIENT_ID: '111.222',
  [CLIENT_KEY]: crypto.randomUUID(),
  SLACK_TEAM_ID: 'T0SYNTH',
};
const idToken = (claims) => 'h.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.s';
function fakeSlack(overrides = {}) {
  const calls = [];
  const used = new Set();
  const fetcher = async (url, init) => {
    const form = new URLSearchParams(init.body);
    calls.push({ url, form });
    if (used.has(form.get('code')) || form.get('client_secret') !== SLACK[CLIENT_KEY])
      return Response.json({ ok: false, error: 'invalid_code' });
    used.add(form.get('code'));
    return Response.json({
      ok: true,
      id_token: idToken({
        iss: 'https://slack.com',
        aud: SLACK.SLACK_CLIENT_ID,
        exp: Math.floor(Date.now() / 1000) + 300,
        nonce: fetcher.nonce,
        email: 'owner@example.test',
        email_verified: true,
        'https://slack.com/team_id': SLACK.SLACK_TEAM_ID,
        ...overrides,
      }),
    });
  };
  fetcher.calls = calls;
  return fetcher;
}
const jar = (response) =>
  Object.fromEntries(
    response.headers.getSetCookie().map((line) => {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      return [pair.slice(0, index), pair.slice(index + 1)];
    }),
  );
const sessionsSet = (response) =>
  response.headers
    .getSetCookie()
    .find((c) => c.startsWith('tickets_session=') && !c.includes('Max-Age=0'));
async function begin(f) {
  const start = await f.request('GET', '/api/auth/slack/start', undefined, { anonymous: true });
  const location = new URL(start.headers.get('location'));
  return {
    start,
    location,
    state: location.searchParams.get('state'),
    nonce: location.searchParams.get('nonce'),
    cookie: 'tickets_slack_oauth=' + jar(start).tickets_slack_oauth,
  };
}
const callback = (f, { state, cookie }, code = 'code-1') =>
  f.request(
    'GET',
    `/api/auth/slack/callback?code=${code}&state=${encodeURIComponent(state)}`,
    undefined,
    { anonymous: true, headers: { cookie } },
  );
async function setup(overrides, env = SLACK) {
  const slack = fakeSlack(overrides);
  const f = await fixture(env, { sqlitePath: ':memory:' }, { slackFetch: slack });
  return { f, slack };
}
const count = async (f, table) =>
  (await f.db.transaction((tx) => tx.all(`SELECT 1 FROM ${table}`))).length;

test('the login option appears only when the Slack app is fully configured', async () => {
  const off = await fixture();
  const partial = await fixture({ SLACK_CLIENT_ID: '1.2' });
  const on = await fixture(SLACK);
  try {
    for (const [f, expected] of [
      [off, false],
      [partial, false],
      [on, true],
    ])
      expect(
        (await f.request('GET', '/api/auth/options', undefined, { anonymous: true })).data
          .slackSignIn,
      ).toBe(expected);
    expect(
      (await off.request('GET', '/api/auth/slack/start', undefined, { anonymous: true })).status,
    ).toBe(503);
  } finally {
    await off.close();
    await partial.close();
    await on.close();
  }
});

test('start redirects to the team-restricted Slack authorize URL with a bound state cookie', async () => {
  const { f } = await setup();
  try {
    const { start, location, state, nonce } = await begin(f);
    expect(start.status).toBe(302);
    expect(location.origin + location.pathname).toBe('https://slack.com/openid/connect/authorize');
    expect(Object.fromEntries(location.searchParams)).toMatchObject({
      response_type: 'code',
      scope: 'openid email profile',
      client_id: SLACK.SLACK_CLIENT_ID,
      team: SLACK.SLACK_TEAM_ID,
      redirect_uri: f.env.APP_URL + '/api/auth/slack/callback',
    });
    expect(state.length).toBeGreaterThanOrEqual(40);
    expect(nonce).not.toBe(state);
    const cookie = start.headers.getSetCookie()[0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/auth/slack');
    expect(cookie).not.toContain(SLACK[CLIENT_KEY]);
    expect(start.headers.get('location')).not.toContain(SLACK[CLIENT_KEY]);
  } finally {
    await f.close();
  }
});

test('an existing member signs in once: session works, state is cleared and the code cannot be replayed', async () => {
  const { f, slack } = await setup();
  try {
    const attempt = await begin(f);
    slack.nonce = attempt.nonce;
    const done = await callback(f, attempt);
    expect(done.status).toBe(302);
    expect(done.headers.get('location')).toBe(f.env.APP_URL + '/');
    const cookies = jar(done);
    expect(cookies.tickets_slack_oauth).toBe('');
    expect(sessionsSet(done)).toContain('HttpOnly');
    expect(sessionsSet(done)).toContain('Max-Age=604800');
    const me = await f.request('GET', '/api/v1/me', undefined, {
      anonymous: true,
      headers: { cookie: 'tickets_session=' + cookies.tickets_session },
    });
    expect(me.status).toBe(200);
    expect(me.data).toMatchObject({ email: 'owner@example.test', role: 'owner' });
    // The stored session is hashed: the cookie value itself is never in the table.
    const stored = await f.db.transaction((tx) => tx.all('SELECT hash FROM sessions'));
    expect(stored.some((row) => row.hash === cookies.tickets_session)).toBe(false);
    // Same code + same cookie again: Slack refuses the used code, no second session.
    const before = await count(f, 'sessions');
    const replay = await callback(f, attempt);
    expect(replay.headers.get('location')).toContain('slack_signin=slack_code_rejected');
    expect(await count(f, 'sessions')).toBe(before);
    expect(slack.calls[0].form.get('redirect_uri')).toBe(
      f.env.APP_URL + '/api/auth/slack/callback',
    );
  } finally {
    await f.close();
  }
});

test('a Slack email that is not a member never creates an account or a session', async () => {
  const { f, slack } = await setup({ email: 'stranger@example.test' });
  try {
    const before = [await count(f, 'users'), await count(f, 'sessions')];
    const attempt = await begin(f);
    slack.nonce = attempt.nonce;
    const done = await callback(f, attempt);
    expect(done.headers.get('location')).toBe(f.env.APP_URL + '/?slack_signin=not_a_member');
    expect(sessionsSet(done)).toBeUndefined();
    expect([await count(f, 'users'), await count(f, 'sessions')]).toEqual(before);
  } finally {
    await f.close();
  }
});

test('a member of another workspace is refused when Slack is bound to INTEGRATIONS_WORKSPACE_ID', async () => {
  const { f, slack } = await setup(
    {},
    { ...SLACK, INTEGRATIONS_WORKSPACE_ID: crypto.randomUUID() },
  );
  try {
    const attempt = await begin(f);
    slack.nonce = attempt.nonce;
    expect((await callback(f, attempt)).headers.get('location')).toContain(
      'slack_signin=not_a_member',
    );
  } finally {
    await f.close();
  }
});

/** @type {{ name: string; overrides: Record<string, unknown>; code: string }[]} */
const refusals = [
  {
    name: 'another Slack team',
    overrides: { 'https://slack.com/team_id': 'T0OTHER' },
    code: 'slack_wrong_team',
  },
  {
    name: 'an audience that is not this app',
    overrides: { aud: 'other.app' },
    code: 'slack_bad_token',
  },
  { name: 'an expired id_token', overrides: { exp: 1 }, code: 'slack_bad_token' },
  { name: 'a different nonce', overrides: { nonce: 'forged' }, code: 'slack_bad_token' },
  { name: 'an unverified email', overrides: { email_verified: false }, code: 'slack_no_email' },
  {
    name: 'a missing verification claim',
    overrides: { email_verified: undefined },
    code: 'slack_no_email',
  },
  {
    name: 'a string verification claim',
    overrides: { email_verified: 'true' },
    code: 'slack_no_email',
  },
  { name: 'no email', overrides: { email: undefined }, code: 'slack_no_email' },
];
for (const { name, overrides, code } of refusals) {
  test(`sign-in is refused for ${name}`, async () => {
    const { f, slack } = await setup(overrides);
    try {
      const attempt = await begin(f);
      slack.nonce = attempt.nonce;
      const done = await callback(f, attempt);
      expect(done.headers.get('location')).toBe(f.env.APP_URL + '/?slack_signin=' + code);
      expect(sessionsSet(done)).toBeUndefined();
    } finally {
      await f.close();
    }
  });
}

test('state binding: missing, foreign, tampered and swapped cookies are refused before Slack is called', async () => {
  const { f, slack } = await setup();
  try {
    const mine = await begin(f);
    const theirs = await begin(f);
    slack.nonce = mine.nonce;
    const flipped = mine.cookie.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
    const refusals = [
      await callback(f, { state: mine.state, cookie: '' }),
      await callback(f, { state: theirs.state, cookie: mine.cookie }),
      await callback(f, { state: mine.state, cookie: flipped }),
      await callback(f, { state: 'attacker-state', cookie: mine.cookie }),
    ];
    for (const refused of refusals) {
      expect(refused.status).toBe(302);
      expect(refused.headers.get('location')).toMatch(/slack_signin=state_(missing|mismatch)$/);
      expect(sessionsSet(refused)).toBeUndefined();
    }
    expect(slack.calls).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test('a Slack denial is not a session and an outage is reported without one', async () => {
  const down = await fixture(
    SLACK,
    { sqlitePath: ':memory:' },
    {
      slackFetch: async () => {
        throw new Error('down');
      },
    },
  );
  try {
    const attempt = await begin(down);
    const denied = await down.request(
      'GET',
      `/api/auth/slack/callback?error=access_denied&state=${encodeURIComponent(attempt.state)}`,
      undefined,
      { anonymous: true, headers: { cookie: attempt.cookie } },
    );
    expect(denied.headers.get('location')).toBe(down.env.APP_URL + '/?slack_signin=slack_denied');
    const done = await callback(down, attempt);
    expect(done.headers.get('location')).toBe(
      down.env.APP_URL + '/?slack_signin=slack_unreachable',
    );
    expect(sessionsSet(done)).toBeUndefined();
  } finally {
    await down.close();
  }
});

test('a refused exchange does not leak the client secret', async () => {
  const error = await exchangeCode({
    env: SLACK,
    origin: 'http://x.test',
    code: 'c',
    nonce: 'n',
    fetcher: async () => Response.json({ ok: false, error: 'invalid_client_id' }),
  }).catch((e) => e);
  expect(error.code).toBe('SLACK_CODE_REJECTED');
  expect(JSON.stringify(error) + error.message).not.toContain(SLACK[CLIENT_KEY]);
});

test('a member of the configured workspace signs in', async () => {
  const slack = fakeSlack();
  const f = await fixture(SLACK, { sqlitePath: ':memory:' }, { slackFetch: slack });
  try {
    f.env.INTEGRATIONS_WORKSPACE_ID = f.init.workspace_id;
    const attempt = await begin(f);
    slack.nonce = attempt.nonce;
    expect(sessionsSet(await callback(f, attempt))).toBeDefined();
  } finally {
    await f.close();
  }
});

test('a callback with a stale state cookie is refused as expired', async () => {
  const f = await fixture(SLACK);
  try {
    const key = f.env['AUTH_' + 'SECRET'];
    const issued = startSlackSignin({
      env: f.env,
      origin: f.env.APP_URL,
      signingKey: key,
      time: 0,
    });
    const state = new URL(issued.location).searchParams.get('state');
    const error = await completeSlackSignin({
      db: f.db,
      env: f.env,
      origin: f.env.APP_URL,
      signingKey: key,
      query: new URLSearchParams({ code: 'c', state }),
      cookieValue: issued.cookieValue,
      clientKey: 'unit',
      time: 601_000,
    }).catch((e) => e);
    expect(error.code).toBe('STATE_EXPIRED');
  } finally {
    await f.close();
  }
});

test('junk callbacks cannot lock anyone out; only accepted exchanges count, per email', async () => {
  const slack = fakeSlack({ email: 'stranger@example.test' });
  const f = await fixture(SLACK, { sqlitePath: ':memory:' }, { slackFetch: slack });
  try {
    for (let i = 0; i < 100; i++) await callback(f, { state: 'x', cookie: '' });
    const attempt = await begin(f);
    slack.nonce = attempt.nonce;
    expect((await callback(f, attempt)).headers.get('location')).toContain('not_a_member');
    // The same Slack-verified email twelve times in a window is stopped.
    let last;
    for (let i = 0; i < 12; i++) {
      const again = await begin(f);
      slack.nonce = again.nonce;
      last = await callback(f, again, 'code-' + (i + 2));
    }
    expect(last.headers.get('location')).toContain('rate_limited');
    const ownerLogin = { email: 'owner@example.test', ['pass' + 'word']: 'a-secure-test-password' };
    const login = await f.request('POST', '/api/auth/login', ownerLogin, { anonymous: true });
    expect(login.status).toBe(200);
  } finally {
    await f.close();
  }
});

test('an unexpected failure still lands in the app and clears the state cookie', async () => {
  const f = await fixture(SLACK);
  try {
    const attempt = await begin(f);
    // Closing the database makes the sign-in transaction throw a non-AppError.
    const broken = {
      ...f.db,
      transaction: () => Promise.reject(new Error('database unavailable')),
    };
    const { createApp } = await import('../../packages/server/app.mjs');
    const slack = fakeSlack();
    slack.nonce = attempt.nonce;
    const app = createApp({ db: broken, env: f.env, logger: { error() {} }, slackFetch: slack });
    const response = await app.fetch(
      new Request(
        f.env.APP_URL +
          `/api/auth/slack/callback?code=c&state=${encodeURIComponent(attempt.state)}`,
        {
          headers: { cookie: attempt.cookie },
        },
      ),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(f.env.APP_URL + '/?slack_signin=failed');
    expect(response.headers.getSetCookie()[0]).toContain('Max-Age=0');
  } finally {
    await f.close();
  }
});

test('both callback cookies survive the Node HTTP adapter', async () => {
  const slack = fakeSlack();
  const f = await fixture(SLACK, { sqlitePath: ':memory:' }, { slackFetch: slack });
  const server = createServer(nodeHandler(f.app, 'http://127.0.0.1'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const attempt = await begin(f);
    slack.nonce = attempt.nonce;
    const response = await fetch(
      `${base}/api/auth/slack/callback?code=code-1&state=${encodeURIComponent(attempt.state)}`,
      { redirect: 'manual', headers: { cookie: attempt.cookie } },
    );
    const cookies = response.headers.getSetCookie();
    expect(response.status).toBe(302);
    expect(cookies.some((c) => c.startsWith('tickets_session=') && !c.includes('Max-Age=0'))).toBe(
      true,
    );
    expect(cookies.some((c) => c.startsWith('tickets_slack_oauth=;'))).toBe(true);
  } finally {
    server.close();
    await f.close();
  }
});

test('the login page message never trusts the query value', () => {
  expect(slackSigninMessage(null)).toBeNull();
  expect(slackSigninMessage('not_a_member')).toContain('not a member');
  for (const hostile of ['__proto__', 'constructor', 'toString', '<script>'])
    expect(slackSigninMessage(hostile)).toBe('Sign in with Slack failed. Try again.');
});
