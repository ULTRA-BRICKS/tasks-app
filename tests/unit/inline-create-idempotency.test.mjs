import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';

// Synthetic login for an in-memory test database only.
const viewerLogin = ['synthetic', 'viewer', 'login'].join('-');
const attempt = (name) => ({ headers: { 'idempotency-key': `combobox-${name}` } });

async function signInAsViewer(f) {
  const invite = (
    await f.request('POST', '/api/v1/invitations', {
      email: 'combobox-viewer@example.test',
      role: 'viewer',
    })
  ).data;
  const accepted = await f.request('POST', '/api/auth/accept-invite', {
    token: invite.token,
    name: 'Reader',
    password: viewerLogin,
  });
  expect(accepted.status).toBe(201);
  const login = await f.request('POST', '/api/auth/login', {
    email: 'combobox-viewer@example.test',
    password: viewerLogin,
  });
  f.setSession(login.headers.get('set-cookie').split(';')[0]);
}

const labelCount = async (f, name) =>
  (await f.request('GET', '/api/v1/catalog')).data.labels.filter((label) => label.name === name)
    .length;

test('inline label creation retried with one idempotency key creates one label', async () => {
  const f = await fixture();
  try {
    const input = { name: 'Needs design', color: '#8b5cf6' };
    const first = await f.request('POST', '/api/v1/labels', input, attempt('label-retry'));
    const retry = await f.request('POST', '/api/v1/labels', input, attempt('label-retry'));
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.data.id).toBe(first.data.id);
    expect(await labelCount(f, 'Needs design')).toBe(1);
    const changed = await f.request(
      'POST',
      '/api/v1/labels',
      { ...input, name: 'Other label' },
      attempt('label-retry'),
    );
    expect(changed.status).toBe(409);
    expect(changed.data.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await labelCount(f, 'Other label')).toBe(0);
  } finally {
    await f.close();
  }
});

test('a concurrent label with the same name answers 409 so the client selects it', async () => {
  const f = await fixture();
  try {
    const input = { name: 'Race', color: '#8b5cf6' };
    const winner = await f.request('POST', '/api/v1/labels', input, attempt('label-winner'));
    const loser = await f.request('POST', '/api/v1/labels', input, attempt('label-loser'));
    expect(winner.status).toBe(201);
    expect(loser.status).toBe(409);
    expect(loser.data.error.code).toBe('ALREADY_EXISTS');
    // A failed create must not poison its key: the same retry still reports the conflict.
    const loserRetry = await f.request('POST', '/api/v1/labels', input, attempt('label-loser'));
    expect(loserRetry.status).toBe(409);
    expect(await labelCount(f, 'Race')).toBe(1);
  } finally {
    await f.close();
  }
});

test('inline milestone creation retried with one idempotency key creates one milestone', async () => {
  const f = await fixture();
  try {
    const project = (
      await f.request('POST', '/api/v1/projects', { name: 'Launch', team_ids: [f.init.team_id] })
    ).data;
    const input = { project_id: project.id, name: 'Beta' };
    const first = await f.request('POST', '/api/v1/milestones', input, attempt('milestone'));
    const retry = await f.request('POST', '/api/v1/milestones', input, attempt('milestone'));
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.data.id).toBe(first.data.id);
    const milestones = (await f.request('GET', '/api/v1/milestones')).data;
    expect(milestones.filter((m) => m.name === 'Beta')).toHaveLength(1);
    // Keys are bound to their operation: a label create cannot replay a milestone.
    const crossed = await f.request(
      'POST',
      '/api/v1/labels',
      { name: 'Beta', color: '#8b5cf6' },
      attempt('milestone'),
    );
    expect(crossed.status).toBe(409);
    expect(crossed.data.error.code).toBe('IDEMPOTENCY_CONFLICT');
  } finally {
    await f.close();
  }
});

test('viewers cannot create labels or milestones, with or without a key', async () => {
  const f = await fixture();
  try {
    const project = (
      await f.request('POST', '/api/v1/projects', { name: 'Launch', team_ids: [f.init.team_id] })
    ).data;
    await signInAsViewer(f);
    const label = { name: 'Viewer label', color: '#8b5cf6' };
    expect((await f.request('POST', '/api/v1/labels', label, attempt('viewer'))).status).toBe(403);
    expect((await f.request('POST', '/api/v1/labels', label)).status).toBe(403);
    const milestone = { project_id: project.id, name: 'Viewer milestone' };
    expect(
      (await f.request('POST', '/api/v1/milestones', milestone, attempt('viewer'))).status,
    ).toBe(403);
    expect(await labelCount(f, 'Viewer label')).toBe(0);
    const stored = await f.db.transaction((tx) =>
      tx.one('SELECT count(*) AS n FROM idempotency_keys WHERE key=?', ['combobox-viewer']),
    );
    expect(Number(stored.n)).toBe(0);
  } finally {
    await f.close();
  }
});
