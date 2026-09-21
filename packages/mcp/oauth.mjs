import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { id, secret, sha256, now } from '../server/core/crypto.mjs';
import { authenticate, issueToken, rateLimit } from '../server/modules/identity/service.mjs';
import { assert, requirePermission } from '../server/core/errors.mjs';

const expires = (seconds) => new Date(Date.now() + seconds * 1000).toISOString();
const json = (value, status = 200, headers = {}) =>
  Response.json(value, { status, headers: { 'cache-control': 'no-store', ...headers } });
const equal = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const sessionCookie = (request) =>
  request.headers
    .get('cookie')
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith('tickets_session='))
    ?.slice(16);
export async function readLimited(request, max = 131072) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      assert(size <= max, 413, 'TOO_LARGE', 'Request is too large');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createOAuth({ db, env, origin }) {
  const resource = origin + '/api/mcp';
  const sign = (value) => createHmac('sha256', env.AUTH_SECRET).update(value).digest('base64url');
  const allowlist = (
    env.MCP_REDIRECT_URIS || 'https://chatgpt.com/connector_platform_oauth_redirect'
  )
    .split(',')
    .map((x) => x.trim());
  const issuer = origin;
  function client(redirect) {
    const payload = Buffer.from(JSON.stringify({ redirect, version: 1 })).toString('base64url');
    return `tasks.${payload}.${sign(payload)}`;
  }
  function redirectFor(clientId) {
    const parts = typeof clientId === 'string' ? clientId.split('.') : [];
    assert(
      parts.length === 3 && parts[0] === 'tasks' && equal(sign(parts[1]), parts[2]),
      400,
      'invalid_client',
      'Unknown OAuth client',
    );
    let data;
    try {
      data = JSON.parse(Buffer.from(parts[1], 'base64url'));
    } catch {
      throw new Error('Invalid client');
    }
    assert(
      data.version === 1 && allowlist.includes(data.redirect),
      400,
      'invalid_client',
      'OAuth client is not allowed',
    );
    return data.redirect;
  }
  function parameters(input) {
    const redirect = redirectFor(input.client_id);
    assert(redirect === input.redirect_uri, 400, 'invalid_request', 'Redirect URI does not match');
    assert(
      input.response_type === 'code',
      400,
      'unsupported_response_type',
      'Use authorization code',
    );
    assert(input.resource === resource, 400, 'invalid_target', 'Incorrect resource');
    assert(
      input.code_challenge_method === 'S256' &&
        /^[A-Za-z0-9_-]{43}$/.test(input.code_challenge || ''),
      400,
      'invalid_request',
      'S256 PKCE is required',
    );
    assert(
      typeof input.state === 'string' && input.state.length >= 8 && input.state.length <= 2048,
      400,
      'invalid_request',
      'A valid state is required',
    );
    const scopes = [...new Set((input.scope || 'read').split(' '))];
    assert(
      scopes.includes('read') && scopes.every((x) => ['read', 'write'].includes(x)),
      400,
      'invalid_scope',
      'Only read and write are supported',
    );
    return {
      client_id: input.client_id,
      redirect_uri: redirect,
      resource,
      code_challenge: input.code_challenge,
      scope: scopes.join(' '),
      state: input.state,
    };
  }
  async function limit(request, name, count) {
    const key = `mcp-oauth:${name}:${sha256(request.headers.get('x-real-ip') || 'unknown')}`;
    const allowed = await db.transaction(async (tx) => {
      await tx.lock(key);
      return rateLimit(tx, key, count, 60);
    });
    assert(allowed, 429, 'slow_down', 'Too many attempts; retry later');
  }
  async function actorFor(request) {
    return db.transaction((tx) => authenticate(tx, { cookie: sessionCookie(request) }), {
      readOnly: true,
    });
  }
  async function tokens(tx, actor, grant, grantId) {
    const token = await issueToken(tx, actor, {
      name: 'ChatGPT connector',
      scopes: grant.scope.split(' '),
      days: 1,
    });
    token.token = 'mcp_' + secret();
    await tx.exec('UPDATE api_tokens SET hash=?,expires_at=? WHERE id=?', [
      sha256(token.token),
      expires(3600),
      token.id,
    ]);
    const refresh = secret();
    await tx.exec(
      'INSERT INTO mcp_oauth_grants(id,token_id,client_id,resource,refresh_hash,expires_at) VALUES(?,?,?,?,?,?)',
      [
        grantId,
        token.id,
        grant.client_id,
        resource,
        sha256(refresh),
        grant.expires_at || expires(30 * 86400),
      ],
    );
    return {
      access_token: token.token,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refresh,
      scope: grant.scope,
    };
  }
  async function rejectRefresh(tx, hash, clientId) {
    // A spent refresh token is evidence of replay. Commit family revocation;
    // throwing here would roll it back.
    const spent = await tx.one(
      'SELECT g.token_id FROM mcp_oauth_refresh_history h JOIN mcp_oauth_grants g ON g.id=h.grant_id WHERE h.hash=? AND g.client_id=? AND g.resource=?',
      [hash, clientId, resource],
    );
    if (spent) await tx.exec('DELETE FROM api_tokens WHERE id=?', [spent.token_id]);
    return {
      error: 'invalid_grant',
      error_description: 'Refresh token is invalid, revoked or reused. Reconnect to Tasks.',
    };
  }
  async function handle(request) {
    const url = new URL(request.url),
      path = url.pathname;
    if (
      request.method === 'GET' &&
      [
        '/.well-known/oauth-protected-resource',
        '/.well-known/oauth-protected-resource/api/mcp',
      ].includes(path)
    )
      return json({
        resource,
        authorization_servers: [issuer],
        scopes_supported: ['read', 'write'],
        bearer_methods_supported: ['header'],
        resource_name: 'Tasks',
      });
    if (request.method === 'GET' && path === '/.well-known/oauth-authorization-server')
      return json({
        issuer,
        authorization_endpoint: origin + '/api/oauth/authorize',
        token_endpoint: origin + '/api/oauth/token',
        registration_endpoint: origin + '/api/oauth/register',
        revocation_endpoint: origin + '/api/oauth/revoke',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['read', 'write'],
        authorization_response_iss_parameter_supported: true,
      });
    if (path === '/api/oauth/register' && request.method === 'POST') {
      await limit(request, 'register', 20);
      const input = JSON.parse(await readLimited(request, 8192));
      assert(
        input.token_endpoint_auth_method === undefined ||
          input.token_endpoint_auth_method === 'none',
        400,
        'invalid_client_metadata',
        'Public PKCE clients only',
      );
      assert(
        Array.isArray(input.redirect_uris) &&
          input.redirect_uris.length === 1 &&
          allowlist.includes(input.redirect_uris[0]),
        400,
        'invalid_redirect_uri',
        'Register the exact configured callback URI',
      );
      const redirect = new URL(input.redirect_uris[0]);
      assert(
        redirect.protocol === 'https:' &&
          !redirect.hash &&
          !redirect.username &&
          !redirect.password,
        400,
        'invalid_redirect_uri',
        'An HTTPS callback without a fragment is required',
      );
      return json(
        {
          client_id: client(input.redirect_uris[0]),
          redirect_uris: input.redirect_uris,
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          client_name: 'ChatGPT',
        },
        201,
      );
    }
    if (path === '/api/oauth/authorize' && request.method === 'GET') {
      const data = parameters(Object.fromEntries(url.searchParams));
      const actor = await actorFor(request);
      const nonce = secret();
      const payload = JSON.stringify(data).replace(/</g, '\\u003c');
      const content = actor
        ? `<p>Connect ChatGPT to the workspace of <strong>${escape(actor.email)}</strong>.</p><p>Permissions: ${data.scope.includes('write') ? 'Read and update tasks' : 'Read tasks'}. ChatGPT can ${data.scope.includes('write') ? 'read, create and update tasks and comments' : 'read tasks'} using your existing permissions. It cannot manage members or delete issues.</p><button id="allow">Connect</button><button id="deny">Cancel</button><p id="result" role="status"></p><script nonce="${nonce}">const data=${payload};async function submit(approved){const r=await fetch('/api/oauth/authorize',{method:'POST',headers:{'content-type':'application/json','x-tickets-csrf':'1'},body:JSON.stringify({...data,response_type:'code',code_challenge_method:'S256',approved})});const v=await r.json();if(r.ok)location.assign(v.redirect);else document.getElementById('result').textContent=v.error_description||'Could not connect.';}document.getElementById('allow').onclick=()=>submit(true);document.getElementById('deny').onclick=()=>submit(false);</script>`
        : '<p>Sign in to your Tasks workspace first, then return here and refresh this page.</p><a href="/login" target="_blank" rel="noopener">Sign in to Tasks</a><p>After signing in, refresh this page to continue.</p>';
      return new Response(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Tasks to ChatGPT</title><style nonce="${nonce}">body{font:18px system-ui;max-width:38rem;margin:4rem auto;padding:1.5rem;line-height:1.6;color:#17252a;background:#fafafa}button,a{font:inherit;padding:.6rem 1rem;margin:.4rem;cursor:pointer}button{border:1px solid #527b79;border-radius:.4rem}button:first-of-type{background:#176e63;color:white}</style><h1>Connect Tasks to ChatGPT</h1>${content}</html>`,
        {
          headers: {
            'content-type': 'text/html;charset=utf-8',
            'cache-control': 'no-store',
            'referrer-policy': 'no-referrer',
            'x-frame-options': 'DENY',
            'content-security-policy': `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`,
          },
        },
      );
    }
    if (path === '/api/oauth/authorize' && request.method === 'POST') {
      assert(
        request.headers.get('origin') === origin && request.headers.get('x-tickets-csrf') === '1',
        403,
        'access_denied',
        'Same-origin consent is required',
      );
      const input = JSON.parse(await readLimited(request, 8192)),
        data = parameters(input),
        actor = await actorFor(request);
      requirePermission(actor, 'read');
      const redirect = new URL(data.redirect_uri);
      redirect.searchParams.set('state', data.state);
      redirect.searchParams.set('iss', issuer);
      if (input.approved !== true) {
        redirect.searchParams.set('error', 'access_denied');
        return json({ redirect: redirect.href });
      }
      for (const scope of data.scope.split(' ')) requirePermission(actor, scope);
      await limit(request, 'authorize', 20);
      const code = secret();
      await db.transaction(async (tx) => {
        await tx.exec('DELETE FROM mcp_oauth_codes WHERE expires_at<?', [now()]);
        await tx.exec(
          'INSERT INTO mcp_oauth_codes(hash,user_id,workspace_id,payload,expires_at) VALUES(?,?,?,?,?)',
          [sha256(code), actor.id, actor.workspace_id, JSON.stringify(data), expires(300)],
        );
      });
      redirect.searchParams.set('code', code);
      return json({ redirect: redirect.href });
    }
    if (path === '/api/oauth/token' && request.method === 'POST') {
      await limit(request, 'token', 60);
      assert(
        request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'),
        415,
        'invalid_request',
        'Use form encoding',
      );
      const input = Object.fromEntries(new URLSearchParams(await readLimited(request, 8192)));
      redirectFor(input.client_id);
      assert(input.resource === resource, 400, 'invalid_target', 'Incorrect resource');
      const result = await db.transaction(async (tx) => {
        await tx.lock('mcp-oauth:exchange:' + sha256(input.code || input.refresh_token || ''));
        if (input.grant_type === 'authorization_code') {
          const row = await tx.one('SELECT * FROM mcp_oauth_codes WHERE hash=? AND expires_at>?', [
            sha256(input.code || ''),
            now(),
          ]);
          assert(row, 400, 'invalid_grant', 'Code is invalid, expired or already used');
          const grant = JSON.parse(row.payload);
          assert(
            grant.client_id === input.client_id &&
              grant.redirect_uri === input.redirect_uri &&
              grant.resource === input.resource,
            400,
            'invalid_grant',
            'Grant binding does not match',
          );
          assert(
            /^[A-Za-z0-9._~-]{43,128}$/.test(input.code_verifier || '') &&
              equal(
                createHash('sha256').update(input.code_verifier).digest('base64url'),
                grant.code_challenge,
              ),
            400,
            'invalid_grant',
            'PKCE verification failed',
          );
          const member = await tx.one(
            'SELECT role FROM memberships WHERE workspace_id=? AND user_id=?',
            [row.workspace_id, row.user_id],
          );
          assert(member, 400, 'invalid_grant', 'Membership no longer exists');
          const scopes = member.role === 'viewer' ? ['read'] : ['read', 'write'];
          const actor = { id: row.user_id, workspace_id: row.workspace_id, scopes };
          const value = await tokens(tx, actor, grant, id());
          await tx.exec('DELETE FROM mcp_oauth_codes WHERE hash=?', [row.hash]);
          return value;
        }
        assert(
          input.grant_type === 'refresh_token',
          400,
          'unsupported_grant_type',
          'Unsupported grant type',
        );
        const row = await tx.one(
          'SELECT g.*,t.user_id,t.workspace_id,t.scopes FROM mcp_oauth_grants g JOIN api_tokens t ON t.id=g.token_id WHERE g.refresh_hash=? AND g.expires_at>?',
          [sha256(input.refresh_token || ''), now()],
        );
        if (!row) return rejectRefresh(tx, sha256(input.refresh_token || ''), input.client_id);
        assert(
          row.client_id === input.client_id && row.resource === input.resource,
          400,
          'invalid_grant',
          'Refresh token is invalid or revoked',
        );
        const member = await tx.one(
          'SELECT role FROM memberships WHERE workspace_id=? AND user_id=?',
          [row.workspace_id, row.user_id],
        );
        assert(member, 400, 'invalid_grant', 'Membership no longer exists');
        const actor = {
          id: row.user_id,
          workspace_id: row.workspace_id,
          scopes: member.role === 'viewer' ? ['read'] : ['read', 'write'],
        };
        const scope = JSON.parse(row.scopes)
          .filter((s) => actor.scopes.includes(s))
          .join(' ');
        const refresh = secret(),
          access = 'mcp_' + secret();
        // Lock parent before child, matching Settings deletion and FK cascade.
        const parent = await tx.one(
          'SELECT id FROM api_tokens WHERE id=?' + (tx.dialect === 'postgres' ? ' FOR UPDATE' : ''),
          [row.token_id],
        );
        if (!parent) return rejectRefresh(tx, sha256(input.refresh_token || ''), input.client_id);
        // Consume atomically. Revocation or a competing rotation must never
        // recreate a deleted family, including ordinary Settings token deletion.
        const consumed = await tx.exec(
          'UPDATE mcp_oauth_grants SET refresh_hash=? WHERE id=? AND refresh_hash=? AND expires_at>?',
          [sha256(refresh), row.id, row.refresh_hash, now()],
        );
        if (consumed.changes !== 1)
          return rejectRefresh(tx, sha256(input.refresh_token || ''), input.client_id);
        await tx.exec(
          'INSERT INTO mcp_oauth_refresh_history(hash,grant_id,expires_at) VALUES(?,?,?)',
          [row.refresh_hash, row.id, row.expires_at],
        );
        // Preserve the token row ID so the visible Settings revoke action keeps
        // referring to the same connection across rotations.
        const updated = await tx.exec(
          'UPDATE api_tokens SET hash=?,scopes=?,expires_at=? WHERE id=?',
          [sha256(access), JSON.stringify(scope.split(' ')), expires(3600), row.token_id],
        );
        assert(updated.changes === 1, 400, 'invalid_grant', 'Connection was revoked');
        return {
          access_token: access,
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: refresh,
          scope,
        };
      });
      return json(result, result.error ? 400 : 200);
    }
    if (path === '/api/oauth/revoke' && request.method === 'POST') {
      await limit(request, 'revoke', 60);
      const input = Object.fromEntries(new URLSearchParams(await readLimited(request, 8192)));
      redirectFor(input.client_id);
      await db.transaction(async (tx) => {
        const row = await tx.one(
          'SELECT g.* FROM mcp_oauth_grants g JOIN api_tokens t ON t.id=g.token_id WHERE g.client_id=? AND (g.refresh_hash=? OR t.hash=?)',
          [input.client_id, sha256(input.token || ''), sha256(input.token || '')],
        );
        if (row) {
          await tx.exec('DELETE FROM api_tokens WHERE id=?', [row.token_id]);
        }
      });
      return json({});
    }
    return json(
      { error: 'invalid_request', error_description: 'Unknown OAuth endpoint or method' },
      404,
    );
  }
  async function verify(request) {
    const bearer = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
    if (!bearer) return null;
    return db.transaction(
      async (tx) => {
        const grant = await tx.one(
          'SELECT g.id FROM mcp_oauth_grants g JOIN api_tokens t ON t.id=g.token_id WHERE t.hash=? AND g.resource=? AND g.expires_at>?',
          [sha256(bearer), resource, now()],
        );
        return grant ? authenticate(tx, { bearer }) : null;
      },
      { readOnly: true },
    );
  }
  return { handle, verify, resource };
}
