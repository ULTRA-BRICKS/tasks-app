import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { hashPassword, id } from '../../packages/server/core/crypto.mjs';
import { normalizeDomain } from '../../packages/server/modules/workspace-policy/service.mjs';
const t = (name, fn) =>
  test(name, async () => {
    const f = await fixture();
    try {
      await fn(f);
    } finally {
      await f.close();
    }
  });
const policy = (f, method = 'GET', data, options = {}) =>
  f.request(method, '/api/v1/workspace/policy', data, options);
const invite = (f, email) =>
  f.request('POST', '/api/v1/invitations', { email, role: 'member' });
const invalidDomain = (error) => error.code === 'INVALID_DOMAIN';
test('normalization stores exact IDNA lowercase domains', () => {
  assert.equal(normalizeDomain('Example.COM'), 'example.com');
  assert.equal(normalizeDomain('Bücher.Example.COM'), 'xn--bcher-kva.example.com');
  assert.equal(normalizeDomain('xn--BCHER-KVA.example.com'), 'xn--bcher-kva.example.com');
  assert.equal(normalizeDomain('example.com.'), 'example.com');
});
test('normalization rejects wildcards URLs IPs and malformed domains', () => {
  for (const value of [
    '*.example.com',
    'https://example.com',
    'example.com/path',
    '192.168.1.1',
    '[::1]',
    'user@example.com',
    'example.com:8080',
    'localhost',
    '-bad.example.com',
    'bad-.example.com',
    'example.com..',
    'example com',
    '',
    'a'.repeat(64) + '.com',
  ])
    assert.throws(() => normalizeDomain(value), invalidDomain, value);
});
t('policy reads need auth; writes need admin role and admin token scope', async (f) => {
  assert.equal((await policy(f, 'GET', undefined, { anonymous: true })).status, 401);
  assert.deepEqual((await policy(f)).data, { allowed_email_domains: [], version: 1 });
  const writeToken = (
    await f.request('POST', '/api/v1/tokens', { name: 'Write', scopes: ['read', 'write'] })
  ).data;
  const denied = await policy(
    f,
    'PATCH',
    { allowed_email_domains: ['example.com'], version: 1 },
    { anonymous: true, headers: { authorization: `Bearer ${writeToken.token}` } },
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.data.error.code, 'INSUFFICIENT_SCOPE');
  const adminToken = (
    await f.request('POST', '/api/v1/tokens', {
      name: 'Admin',
      scopes: ['read', 'write', 'admin'],
    })
  ).data;
  const granted = await policy(
    f,
    'PATCH',
    { allowed_email_domains: [], version: 1 },
    { anonymous: true, headers: { authorization: `Bearer ${adminToken.token}` } },
  );
  assert.equal(granted.status, 200);
  const invitation = (await invite(f, 'member@example.test')).data;
  await f.request('POST', '/api/auth/accept-invite', {
    token: invitation.token,
    name: 'Member',
    password: 'a-member-password1',
  });
  const login = await f.request('POST', '/api/auth/login', {
    email: 'member@example.test',
    password: 'a-member-password1',
  });
  assert.equal(login.status, 200);
  const ownerSession = f.session;
  f.setSession(login.headers.get('set-cookie').split(';')[0]);
  assert.equal((await policy(f)).status, 200);
  assert.equal(
    (await policy(f, 'PATCH', { allowed_email_domains: ['example.com'], version: 2 })).status,
    403,
  );
  f.setSession(ownerSession);
});
t('writes normalize deduplicate and reject invalid domains', async (f) => {
  const r = await policy(f, 'PATCH', {
    allowed_email_domains: ['Example.COM', 'Bücher.Example.COM', 'EXAMPLE.com'],
    version: 1,
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.allowed_email_domains, ['example.com', 'xn--bcher-kva.example.com']);
  assert.equal(r.data.version, 2);
  const stored = await f.db.transaction((tx) =>
    tx.one('SELECT allowed_email_domains FROM workspace_policy WHERE workspace_id=?', [
      f.init.workspace_id,
    ]),
  );
  assert.equal(stored.allowed_email_domains, '["example.com","xn--bcher-kva.example.com"]');
  for (const bad of ['*.example.com', 'https://example.com', 'user@example.com'])
    assert.equal(
      (await policy(f, 'PATCH', { allowed_email_domains: [bad], version: 2 })).status,
      422,
      bad,
    );
  const service = await policy(f, 'PATCH', {
    allowed_email_domains: ['192.168.1.1'],
    version: 2,
  });
  assert.equal(service.status, 422);
  assert.equal(service.data.error.code, 'INVALID_DOMAIN');
  const tooMany = await policy(f, 'PATCH', {
    allowed_email_domains: Array.from({ length: 51 }, (_, i) => `team${i}.test`),
    version: 2,
  });
  assert.equal(tooMany.status, 422);
});
t('empty allowlist allows invitations from any domain', async (f) => {
  assert.deepEqual((await policy(f)).data.allowed_email_domains, []);
  assert.equal((await invite(f, 'x@anywhere.test')).status, 201);
});
t('invite issuance enforces the allowlist exactly', async (f) => {
  await policy(f, 'PATCH', { allowed_email_domains: ['example.com'], version: 1 });
  const blocked = await invite(f, 'x@other.test');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error.code, 'DOMAIN_NOT_ALLOWED');
  assert.deepEqual(blocked.data.error.details.allowed_email_domains, ['example.com']);
  assert.equal((await invite(f, 'x@sub.example.com')).status, 403);
  assert.equal((await invite(f, 'x@EXAMPLE.com')).status, 201);
});
t('changed policy invalidates outstanding invitations at acceptance', async (f) => {
  const invitation = (await invite(f, 'old@other.test')).data;
  await policy(f, 'PATCH', { allowed_email_domains: ['example.com'], version: 1 });
  const blocked = await f.request('POST', '/api/auth/accept-invite', {
    token: invitation.token,
    name: 'Old',
    password: 'a-secure-test-password',
  });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error.code, 'DOMAIN_NOT_ALLOWED');
  await policy(f, 'PATCH', { allowed_email_domains: [], version: 2 });
  const accepted = await f.request('POST', '/api/auth/accept-invite', {
    token: invitation.token,
    name: 'Old',
    password: 'a-secure-test-password',
  });
  assert.equal(accepted.status, 201);
});
t('existing users still log in under a restrictive policy', async (f) => {
  await policy(f, 'PATCH', { allowed_email_domains: ['example.com'], version: 1 });
  assert.equal(
    (
      await f.request('POST', '/api/auth/login', {
        email: 'owner@example.test',
        password: 'a-secure-test-password',
      })
    ).status,
    200,
  );
});
t('version conflicts include the current setting', async (f) => {
  await policy(f, 'PATCH', { allowed_email_domains: ['example.com'], version: 1 });
  const stale = await policy(f, 'PATCH', { allowed_email_domains: ['other.test'], version: 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error.code, 'VERSION_CONFLICT');
  assert.deepEqual(stale.data.error.details.current, {
    allowed_email_domains: ['example.com'],
    version: 2,
  });
});
t('policy is isolated per workspace', async (f) => {
  await policy(f, 'PATCH', { allowed_email_domains: ['example.com'], version: 1 });
  const password = 'another-secure-password',
    email = 'owner2@other.test';
  await f.db.transaction(async (tx) => {
    const workspace = id(),
      user = id(),
      created = new Date().toISOString();
    await tx.exec('INSERT INTO workspaces(id,name,slug,created_at) VALUES(?,?,?,?)', [
      workspace,
      'Second',
      'second',
      created,
    ]);
    await tx.exec('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)', [
      user,
      email,
      'Owner Two',
      await hashPassword(password),
      created,
    ]);
    await tx.exec('INSERT INTO memberships(workspace_id,user_id,role) VALUES(?,?,?)', [
      workspace,
      user,
      'owner',
    ]);
  });
  const login = await f.request('POST', '/api/auth/login', {
    email,
    password,
    workspace_slug: 'second',
  });
  assert.equal(login.status, 200);
  const ownerSession = f.session;
  f.setSession(login.headers.get('set-cookie').split(';')[0]);
  assert.deepEqual((await policy(f)).data, { allowed_email_domains: [], version: 1 });
  assert.equal(
    (await policy(f, 'PATCH', { allowed_email_domains: ['other.test'], version: 1 })).status,
    200,
  );
  assert.equal((await invite(f, 'friend@other.test')).status, 201);
  f.setSession(ownerSession);
  assert.equal((await invite(f, 'friend@other.test')).status, 403);
  assert.deepEqual((await policy(f)).data.allowed_email_domains, ['example.com']);
});
