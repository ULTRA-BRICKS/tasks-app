import { test, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { fixture } from './helpers.mjs';
import { withMcp } from '../../packages/mcp/handler.mjs';
const callback = 'https://chatgpt.com/connector_platform_oauth_redirect';
async function setup(scope = 'read write') {
  const f = await fixture();
  const app = withMcp(f.app, { db: f.db, env: f.env });
  const call = async (path, { method = 'GET', data, headers = {}, raw } = {}) => {
    const response = await app.fetch(
      new Request(f.env.APP_URL + path, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        ...(data === undefined ? {} : { body: raw ? data : JSON.stringify(data) }),
      }),
    );
    const text = await response.text();
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      value = text;
    }
    return { status: response.status, data: value, headers: response.headers };
  };
  const registration = await call('/api/oauth/register', {
    method: 'POST',
    data: { redirect_uris: [callback], token_endpoint_auth_method: 'none' },
  });
  expect(registration.status).toBe(201);
  const verifier = 'a'.repeat(64);
  const auth = {
    client_id: registration.data.client_id,
    redirect_uri: callback,
    response_type: 'code',
    resource: f.env.APP_URL + '/api/mcp',
    state: 'state-for-testing',
    scope,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
  const approve = () =>
    call('/api/oauth/authorize', {
      method: 'POST',
      data: { ...auth, approved: true },
      headers: { cookie: f.session, origin: f.env.APP_URL, 'x-tickets-csrf': '1' },
    });
  const exchange = (data) =>
    call('/api/oauth/token', {
      method: 'POST',
      data: new URLSearchParams(data).toString(),
      raw: true,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
  const approved = await approve();
  expect(approved.status).toBe(200);
  const redirect = new URL(approved.data.redirect);
  expect(redirect.searchParams.get('iss')).toBe(f.env.APP_URL);
  const tokenInput = {
    grant_type: 'authorization_code',
    client_id: auth.client_id,
    redirect_uri: callback,
    resource: auth.resource,
    code: redirect.searchParams.get('code'),
    code_verifier: verifier,
  };
  const token = await exchange(tokenInput);
  expect(token.status).toBe(200);
  const rpc = (name, args = {}, access = token.data.access_token) =>
    call('/api/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${access}` },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    });
  return { ...f, call, rpc, token: token.data, auth, tokenInput, exchange, approve };
}
test('OAuth discovery, explicit consent, task tools, idempotent meeting actions and optimistic conflicts', async () => {
  const f = await setup();
  try {
    const discovery = await f.call('/.well-known/oauth-protected-resource');
    expect(discovery.data.resource).toBe(f.auth.resource);
    const anon = await f.call('/api/mcp', { method: 'POST', data: {} });
    expect(anon.status).toBe(401);
    expect(anon.headers.get('www-authenticate')).toContain('resource_metadata');
    const init = await f.call('/api/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${f.token.access_token}` },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18' },
      },
    });
    expect(init.data.result.protocolVersion).toBe('2025-06-18');
    expect(
      (await f.call('/api/v1/me', { headers: { authorization: 'Bearer ' + f.token.access_token } }))
        .status,
    ).toBe(401);
    for (const authorization of [f.token.access_token, 'Bearer ' + f.token.access_token]) {
      expect(
        (
          await f.call('/graphql', {
            method: 'POST',
            headers: { authorization },
            data: { query: '{ viewer { id } }' },
          })
        ).status,
      ).toBe(401);
    }
    const catalog = await f.rpc('catalog');
    expect(catalog.data.result.structuredContent.people[0].email).toBe('owner@example.test');
    const input = {
      title: 'Meeting decision',
      team_id: f.init.team_id,
      description: 'Source: https://slack.com/archives/test/123',
    };
    const first = await f.rpc('create_issue', { input, idempotency_key: 'meeting:1:action:1' });
    expect(first.data.result.isError).toBeUndefined();
    const issue = first.data.result.structuredContent;
    const retry = await f.rpc('create_issue', { input, idempotency_key: 'meeting:1:action:1' });
    expect(retry.data.result.structuredContent.id).toBe(issue.id);
    const changed = await f.rpc('create_issue', {
      input: { ...input, title: 'Different' },
      idempotency_key: 'meeting:1:action:1',
    });
    expect(changed.data.result.isError).toBe(true);
    const search = await f.rpc('search', { query: 'Meeting' });
    expect(search.data.result.structuredContent.results[0].id).toBe(issue.key);
    const fetched = await f.rpc('fetch', { id: issue.key });
    expect(fetched.data.result.structuredContent.text).toContain('slack.com');
    const patch = { id: issue.key, input: { version: issue.version, title: 'Agreed action' } };
    expect((await f.rpc('update_issue', patch)).data.result.isError).toBeUndefined();
    expect((await f.rpc('update_issue', patch)).data.result.isError).toBe(true);
    const comment = {
      id: issue.key,
      body: 'Follow-up source',
      idempotency_key: 'meeting:1:comment:1',
    };
    const c1 = await f.rpc('add_comment', comment),
      c2 = await f.rpc('add_comment', comment);
    expect(c1.data.result.structuredContent.id).toBe(c2.data.result.structuredContent.id);
    expect((await f.exchange(f.tokenInput)).status).toBe(400);
  } finally {
    await f.close();
  }
});
test('read-only grants deny writes; refresh rotates, revocation invalidates access', async () => {
  const f = await setup('read');
  try {
    const write = await f.rpc('create_issue', {
      input: { title: 'No', team_id: f.init.team_id },
      idempotency_key: 'read-only',
    });
    expect(write.data.result.isError).toBe(true);
    const refreshInput = {
      grant_type: 'refresh_token',
      client_id: f.auth.client_id,
      resource: f.auth.resource,
      refresh_token: f.token.refresh_token,
    };
    const refreshed = await f.exchange(refreshInput);
    expect(refreshed.status).toBe(200);
    expect((await f.rpc('catalog')).status).toBe(401);
    expect((await f.rpc('catalog', {}, refreshed.data.access_token)).status).toBe(200);
    const revoke = await f.call('/api/oauth/revoke', {
      method: 'POST',
      raw: true,
      data: new URLSearchParams({
        client_id: f.auth.client_id,
        token: refreshed.data.refresh_token,
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(revoke.status).toBe(200);
    expect((await f.rpc('catalog', {}, refreshed.data.access_token)).status).toBe(401);
  } finally {
    await f.close();
  }
});
test('rejects arbitrary callbacks, bad resource, PKCE mismatch, CSRF, cookies at MCP and foreign workspace records', async () => {
  const f = await setup();
  const other = await fixture();
  try {
    const bad = await f.call('/api/oauth/register', {
      method: 'POST',
      data: { redirect_uris: ['https://attacker.example/callback'] },
    });
    expect(bad.status).toBe(400);
    expect(
      (
        await f.call(
          '/api/oauth/authorize?' +
            new URLSearchParams({ ...f.auth, redirect_uri: 'https://attacker.example' }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await f.call('/api/oauth/authorize', {
          method: 'POST',
          data: { ...f.auth, approved: true },
          headers: { cookie: f.session, origin: 'https://attacker.example', 'x-tickets-csrf': '1' },
        })
      ).status,
    ).toBe(403);
    expect(
      (await f.call('/api/mcp', { method: 'POST', data: {}, headers: { cookie: f.session } }))
        .status,
    ).toBe(401);
    const approved = await f.approve(),
      code = new URL(approved.data.redirect).searchParams.get('code');
    expect(
      (await f.exchange({ ...f.tokenInput, code, resource: 'https://attacker.example' })).status,
    ).toBe(400);
    expect(
      (await f.exchange({ ...f.tokenInput, code, code_verifier: 'b'.repeat(64) })).status,
    ).toBe(400);
    expect((await f.exchange({ ...f.tokenInput, code })).status).toBe(200);
    const missing = await f.rpc('fetch', { id: other.init.team_id });
    expect(missing.data.result.isError).toBe(true);
    const stored = await f.db.transaction((tx) => tx.one('SELECT hash FROM api_tokens LIMIT 1'));
    expect(stored.hash).not.toBe(f.token.access_token);
    await f.db.transaction((tx) =>
      tx.exec('UPDATE memberships SET role=? WHERE user_id=?', ['viewer', f.init.user_id]),
    );
    expect(
      (
        await f.rpc('create_issue', {
          input: { title: 'No', team_id: f.init.team_id },
          idempotency_key: 'demoted',
        })
      ).data.result.isError,
    ).toBe(true);
  } finally {
    await f.close();
    await other.close();
  }
});

test('refresh-token replay revokes the active successor and preserves Settings token identity', async () => {
  const f = await setup();
  try {
    const before = await f.db.transaction((tx) => tx.one('SELECT id FROM api_tokens LIMIT 1'));
    const request = {
      grant_type: 'refresh_token',
      client_id: f.auth.client_id,
      resource: f.auth.resource,
      refresh_token: f.token.refresh_token,
    };
    const rotated = await f.exchange(request);
    expect(rotated.status).toBe(200);
    const after = await f.db.transaction((tx) => tx.one('SELECT id FROM api_tokens LIMIT 1'));
    expect(after.id).toBe(before.id);
    expect((await f.exchange(request)).status).toBe(400);
    expect((await f.rpc('catalog', {}, rotated.data.access_token)).status).toBe(401);
    expect(
      (await f.exchange({ ...request, refresh_token: rotated.data.refresh_token })).status,
    ).toBe(400);
  } finally {
    await f.close();
  }
});

test.skipIf(!process.env.TEST_DATABASE_URL)(
  'PostgreSQL revocation between refresh read and consume cannot resurrect a connection',
  async () => {
    for (const mode of ['oauth', 'settings']) {
      const f = await setup();
      const original = f.db.transaction.bind(f.db);
      let selectedResolve, releaseResolve;
      const selected = new Promise((resolve) => {
        selectedResolve = resolve;
      });
      const release = new Promise((resolve) => {
        releaseResolve = resolve;
      });
      let paused = false,
        refreshing;
      f.db.transaction = (fn, options) =>
        original(
          (tx) =>
            fn({
              ...tx,
              one: async (sql, args) => {
                const value = await tx.one(sql, args);
                if (!paused && sql.startsWith('SELECT g.*,t.user_id,t.workspace_id,t.scopes')) {
                  paused = true;
                  selectedResolve();
                  await release;
                }
                return value;
              },
            }),
          options,
        );
      try {
        refreshing = f.exchange({
          grant_type: 'refresh_token',
          client_id: f.auth.client_id,
          resource: f.auth.resource,
          refresh_token: f.token.refresh_token,
        });
        await selected;
        if (mode === 'oauth') {
          const revoked = await f.call('/api/oauth/revoke', {
            method: 'POST',
            raw: true,
            data: new URLSearchParams({
              client_id: f.auth.client_id,
              token: f.token.access_token,
            }).toString(),
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
          });
          expect(revoked.status).toBe(200);
        } else {
          const token = await original((tx) => tx.one('SELECT id FROM api_tokens LIMIT 1'));
          expect((await f.request('DELETE', '/api/v1/tokens/' + token.id)).status).toBe(200);
        }
        releaseResolve();
        expect((await refreshing).status).toBe(400);
        const remaining = await original((tx) =>
          tx.one('SELECT count(*) AS count FROM mcp_oauth_grants'),
        );
        expect(Number(remaining.count)).toBe(0);
        expect((await f.rpc('catalog')).status).toBe(401);
      } finally {
        releaseResolve();
        if (refreshing) await refreshing;
        f.db.transaction = original;
        await f.close();
      }
    }
  },
);
