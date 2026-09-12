import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
import { normalizeDomains } from '../../packages/server/modules/identity/policy.mjs';
const path = '/api/v1/workspace/policy';
test('email domain normalization is exact, IDNA aware and deduplicated', () => {
  expect(normalizeDomains([' EXAMPLE.COM ', 'example.com', 'bücher.de'])).toEqual([
    'example.com',
    'xn--bcher-kva.de',
  ]);
  for (const value of [
    '*.example.com',
    '@example.com',
    'https://example.com',
    '127.0.0.1',
    'localhost',
    'evil/example.com',
    '.example.com',
    'example.com.',
    'a..com',
    '-bad.com',
    'bad-.com',
    'a b.com',
    '',
  ])
    expect(() => normalizeDomains([value])).toThrow();
  expect(() => normalizeDomains('example.com')).toThrow();
  expect(() => normalizeDomains(Array(51).fill('example.com'))).toThrow();
});
test('policy updates are versioned and enforce invitations without locking out members', async () => {
  const f = await fixture();
  try {
    expect((await f.request('GET', path)).data).toMatchObject({
      version: 0,
      allowed_email_domains: [],
    });
    const saved = await f.request('PATCH', path, {
      version: 0,
      allowed_email_domains: ['EXAMPLE.COM'],
    });
    expect(saved.status).toBe(200);
    expect(saved.data.allowed_email_domains).toEqual(['example.com']);
    expect((await f.request('PATCH', path, { version: 0, allowed_email_domains: [] })).status).toBe(
      409,
    );
    for (const email of ['a@sub.example.com', 'a@evil-example.com', 'a@gmail.com'])
      expect(
        (await f.request('POST', '/api/v1/invitations', { email, role: 'member' })).status,
      ).toBe(403);
    expect(
      (await f.request('POST', '/api/v1/invitations', { email: 'a@example.com', role: 'member' }))
        .status,
    ).toBe(201);
    expect((await f.request('GET', '/api/v1/me')).status).toBe(200);
  } finally {
    await f.close();
  }
});
test('accepting an old invitation rechecks the current domain policy', async () => {
  const f = await fixture();
  try {
    const invite = (
      await f.request('POST', '/api/v1/invitations', {
        email: 'guest@outside.test',
        role: 'member',
      })
    ).data;
    await f.request('PATCH', path, { version: 0, allowed_email_domains: ['company.test'] });
    const denied = await f.request(
      'POST',
      '/api/auth/accept-invite',
      { token: invite.token, name: 'Guest', password: 'test-private-password' },
      { anonymous: true },
    );
    expect(denied.status).toBe(403);
    expect(denied.data.error.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
    expect(
      await f.db.transaction((tx) =>
        tx.all('SELECT id FROM users WHERE email=?', ['guest@outside.test']),
      ),
    ).toHaveLength(0);
    const pending = await f.db.transaction((tx) =>
      tx.one('SELECT used_at FROM invitations WHERE id=?', [invite.id]),
    );
    expect(pending.used_at).toBeNull();
    await f.request('PATCH', path, { version: 1, allowed_email_domains: [] });
    expect(
      (
        await f.request(
          'POST',
          '/api/auth/accept-invite',
          { token: invite.token, name: 'Guest', password: 'test-private-password' },
          { anonymous: true },
        )
      ).status,
    ).toBe(201);
  } finally {
    await f.close();
  }
});
test('read-only personal token cannot inspect or modify policy', async () => {
  const f = await fixture();
  try {
    const token = (
      await f.request('POST', '/api/v1/tokens', { name: 'readonly', scopes: ['read'] })
    ).data.token;
    const opts = { anonymous: true, headers: { authorization: `Bearer ${token}` } };
    expect((await f.request('GET', path, undefined, opts)).status).toBe(403);
    expect(
      (await f.request('PATCH', path, { version: 0, allowed_email_domains: ['example.com'] }, opts))
        .status,
    ).toBe(403);
  } finally {
    await f.close();
  }
});

test('invitation domains cannot be truncated from URLs into allowed domains', async () => {
  const f = await fixture();
  try {
    const policy = await f.request('PATCH', '/api/v1/workspace/policy', {
      version: 0,
      allowed_email_domains: ['company.test'],
    });
    expect(policy.status).toBe(200);
    for (const email of [
      'a@company.test/evil.test',
      'a@company.test?evil.test',
      'a@company.test#evil.test',
    ]) {
      const r = await f.request('POST', '/api/v1/invitations', { email, role: 'member' });
      expect(r.status).toBe(403);
      expect(r.data.error.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
    }
  } finally {
    await f.close();
  }
});
