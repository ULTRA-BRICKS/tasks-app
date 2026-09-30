import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { validate, validDate } from '../../packages/contracts/validate.mjs';
import { schemas } from '../../packages/contracts/schemas.mjs';
import { postgresParameters, migrate } from '../../packages/db/index.mjs';
import {
  hashPassword,
  verifyPassword,
  id,
  hmac,
  sha256,
} from '../../packages/server/core/crypto.mjs';
import {
  verifyGitHub,
  verifySlack,
  runWorker,
} from '../../packages/server/modules/integrations/service.mjs';
import { inspectFile, MAX_UPLOAD } from '../../packages/server/modules/attachments/service.mjs';
const t = (name, fn, options = {}) =>
  test(name, async () => {
    const f = await fixture(options);
    try {
      await fn(f);
    } finally {
      await f.close();
    }
  });
test('dates handle leap years and reject silent normalization', () => {
  assert(validDate('2024-02-29'));
  for (const v of ['2025-02-29', '2026-02-30', '2026-13-01', '2026-9-01', '2026-01-01T00:00:00Z'])
    assert(!validDate(v), v);
});
test('validation rejects unknown properties and prototype injection', () => {
  assert.throws(() =>
    validate({ title: 'ok', team_id: id(), workspace_id: id() }, schemas.IssueCreate),
  );
  assert.throws(() => validate(JSON.parse('{"__proto__":{}}'), schemas.IssueCreate));
});
test('validation rejects blank titles and non-finite priorities', () => {
  assert.throws(() => validate({ title: '   ', team_id: id() }, schemas.IssueCreate));
  assert.throws(() => validate({ title: 'x', team_id: id(), priority: NaN }, schemas.IssueCreate));
});
test('Postgres placeholders preserve quoted question marks', () =>
  assert.equal(
    postgresParameters("SELECT '?', 'it''s ?', a=? AND b=?"),
    "SELECT '?', 'it''s ?', a=$1 AND b=$2",
  ));
test('passwords are salted and checked safely', async () => {
  const a = await hashPassword('correct'),
    b = await hashPassword('correct');
  assert.notEqual(a, b);
  assert(await verifyPassword('correct', a));
  assert(!(await verifyPassword('wrong', a)));
  assert(!(await verifyPassword('wrong', 'invalid')));
});
t('migration is idempotent', async (f) => assert.equal((await migrate(f.db)).applied, false));
t('anonymous API requests are denied', async (f) =>
  assert.equal(
    (await f.request('GET', '/api/v1/issues', undefined, { anonymous: true })).status,
    401,
  ),
);
// The browser deletes its saved workspace copy on any 401 (docs/PERSISTENT-READ-CACHE.md), so a
// signed-in member without a permission must get 403 and only a missing or ended session 401.
t('401 means no valid session; a signed-in member without a permission gets 403', async (f) => {
  const label = { name: 'x', color: '#ffffff' };
  await f.db.transaction((tx) =>
    tx.exec("UPDATE memberships SET role='viewer' WHERE workspace_id=? AND user_id=?", [
      f.init.workspace_id,
      f.init.user_id,
    ]),
  );
  assert.equal((await f.request('GET', '/api/v1/me')).status, 200);
  assert.equal((await f.request('POST', '/api/v1/labels', label)).status, 403);
  await f.db.transaction((tx) =>
    tx.exec('UPDATE sessions SET expires_at=? WHERE hash=?', [
      new Date(Date.now() - 1000).toISOString(),
      sha256(f.session.split('=').slice(1).join('=')),
    ]),
  );
  for (const [method, path] of [
    ['GET', '/api/v1/me'],
    ['GET', '/api/v1/issues'],
    ['POST', '/api/v1/labels'],
  ]) {
    const expired = await f.request(method, path, method === 'POST' ? label : undefined);
    assert.deepEqual([expired.status, expired.data.error.code], [401, 'UNAUTHENTICATED'], path);
  }
});
t('CSRF header and origin protect cookie writes', async (f) => {
  assert.equal(
    (await f.request('POST', '/api/v1/labels', { name: 'x', color: '#ffffff' }, { noCsrf: true }))
      .status,
    403,
  );
  assert.equal(
    (
      await f.request(
        'POST',
        '/api/v1/labels',
        { name: 'x', color: '#ffffff' },
        { headers: { origin: 'https://evil.example' } },
      )
    ).status,
    403,
  );
});
t('login cookies are HttpOnly; password hashes are not exposed', async (f) => {
  const r = await f.request('POST', '/api/auth/login', {
    email: 'owner@example.test',
    password: 'a-secure-test-password',
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /HttpOnly/);
  assert(!JSON.stringify(r.data).includes('password_hash'));
});
t('invalid logins count toward rate limit despite failed transactions', async (f) => {
  for (let n = 0; n < 12; n++)
    await f.request('POST', '/api/auth/login', { email: 'owner@example.test', password: 'wrong' });
  assert.equal(
    (await f.request('POST', '/api/auth/login', { email: 'owner@example.test', password: 'wrong' }))
      .status,
    429,
  );
});
t('issue CRUD preserves Markdown labels dates and history', async (f) => {
  const r = await f.create({
    description: '# Hello\n\n- [ ] test',
    label_ids: [f.catalog.labels[0].id],
    due_date: '2026-09-30',
    priority: 1,
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.key, 'TKT-1');
  assert.equal(r.data.label_ids.length, 1);
  const u = await f.request('PATCH', `/api/v1/issues/${r.data.key}`, {
    version: 1,
    title: 'Changed',
  });
  assert.equal(u.data.version, 2);
  const detail = (await f.request('GET', `/api/v1/issues/${r.data.id}`)).data;
  assert.equal(detail.description, r.data.description);
  assert.equal(detail.activity.length, 2);
});
t('concurrent creates have unique sequential issue keys', async (f) => {
  const rows = await Promise.all(
    Array.from({ length: 20 }, (_, i) => f.create({ title: `Issue ${i}` })),
  );
  assert(rows.every((r) => r.status === 201));
  assert.equal(new Set(rows.map((r) => r.data.key)).size, 20);
});
t('stale writes return conflict and current version', async (f) => {
  const a = (await f.create()).data;
  await f.request('PATCH', `/api/v1/issues/${a.id}`, { version: 1, title: 'First' });
  const r = await f.request('PATCH', `/api/v1/issues/${a.id}`, { version: 1, title: 'Stale' });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.details.current.title, 'First');
});
t('idempotent creation deduplicates and detects changed requests', async (f) => {
  const data = { team_id: f.init.team_id, title: 'Once' },
    opt = { headers: { 'idempotency-key': 'test-create-1' } };
  const a = await f.request('POST', '/api/v1/issues', data, opt),
    b = await f.request('POST', '/api/v1/issues', data, opt);
  assert.equal(a.data.id, b.data.id);
  assert.equal(
    (await f.request('POST', '/api/v1/issues', { ...data, title: 'Other' }, opt)).status,
    409,
  );
});
t('bulk edits roll back every change on one version conflict', async (f) => {
  const a = (await f.create()).data,
    b = (await f.create()).data;
  const r = await f.request('PATCH', '/api/v1/issues/bulk', {
    updates: [
      { id: a.id, patch: { version: 1, title: 'Rollback' } },
      { id: b.id, patch: { version: 99, title: 'Bad' } },
    ],
  });
  assert.equal(r.status, 409);
  assert.equal((await f.request('GET', `/api/v1/issues/${a.id}`)).data.title, a.title);
});
t('cross-team workflow status is rejected', async (f) => {
  const team = (await f.request('POST', '/api/v1/teams', { key: 'OPS', name: 'Operations' })).data;
  const s = await f.db.transaction((tx) =>
    tx.one('SELECT id FROM statuses WHERE team_id=?', [team.id]),
  );
  assert.equal((await f.create({ status_id: s.id })).status, 422);
});
t('cross-workspace references cannot attach', async (f) => {
  const wid = id(),
    tid = id(),
    sid = id();
  await f.db.transaction(async (tx) => {
    await tx.exec('INSERT INTO workspaces(id,name,slug,created_at) VALUES(?,?,?,?)', [
      wid,
      'Other',
      'other',
      new Date().toISOString(),
    ]);
    await tx.exec('INSERT INTO teams(id,workspace_id,key,name,next_number) VALUES(?,?,?,?,1)', [
      tid,
      wid,
      'OTH',
      'Other',
    ]);
    await tx.exec(
      'INSERT INTO statuses(id,workspace_id,team_id,name,category,color,position) VALUES(?,?,?,?,?,?,0)',
      [sid, wid, tid, 'Todo', 'unstarted', '#ffffff'],
    );
  });
  assert.equal((await f.create({ team_id: tid })).status, 422);
  assert.equal((await f.create({ status_id: sid })).status, 422);
});
t('parent hierarchy cannot form a cycle', async (f) => {
  const a = (await f.create({ kind: 'epic' })).data,
    b = (await f.create({ parent_id: a.id })).data;
  const r = await f.request('PATCH', `/api/v1/issues/${a.id}`, { version: 1, parent_id: b.id });
  assert.equal(r.status, 422);
  assert.equal(r.data.error.code, 'HIERARCHY_CYCLE');
});
t('blocking DAG rejects loops; symmetric related links deduplicate', async (f) => {
  const a = (await f.create()).data,
    b = (await f.create()).data;
  const rel = (s, t, type) =>
    f.request('POST', `/api/v1/issues/${s}/relations`, { target_id: t, type });
  assert.equal((await rel(a.id, b.id, 'blocks')).status, 201);
  assert.equal((await rel(b.id, a.id, 'blocks')).status, 422);
  assert.equal(
    (await rel(a.id, b.id, 'related')).data.id,
    (await rel(b.id, a.id, 'related')).data.id,
  );
});
t('invalid date ranges fail on server', async (f) => {
  assert.equal((await f.create({ start_date: '2026-09-20', due_date: '2026-09-10' })).status, 422);
  assert.equal((await f.create({ due_date: '2026-02-30' })).status, 422);
});
t('archive soft-delete and restore preserve records', async (f) => {
  const a = (await f.create()).data;
  await f.request('PATCH', `/api/v1/issues/${a.id}`, { version: 1, archived: true });
  assert.equal((await f.request('GET', '/api/v1/issues')).data.data.length, 0);
  assert.equal((await f.request('GET', '/api/v1/issues?archived=true')).data.data.length, 1);
  await f.request('PATCH', `/api/v1/issues/${a.id}`, { version: 2, deleted: true });
  assert.equal((await f.request('GET', `/api/v1/issues/${a.id}`)).status, 404);
  assert.equal(
    (
      await f.request('PATCH', `/api/v1/issues/${a.id}`, {
        version: 3,
        deleted: false,
        archived: false,
      })
    ).status,
    200,
  );
});
t('parent with children cannot be silently deleted', async (f) => {
  const a = (await f.create()).data;
  await f.create({ parent_id: a.id });
  assert.equal(
    (await f.request('PATCH', `/api/v1/issues/${a.id}`, { version: 1, deleted: true })).status,
    409,
  );
});
t('task validation errors keep their codes and speak of tasks', async (f) => {
  const a = (await f.create()).data;
  await f.create({ parent_id: a.id });
  const failures = [
    [
      await f.request('PATCH', `/api/v1/issues/${a.id}`, { version: 1, parent_id: a.id }),
      'SELF_PARENT',
    ],
    [
      await f.request('POST', `/api/v1/issues/${a.id}/relations`, {
        target_id: a.id,
        type: 'related',
      }),
      'SELF_RELATION',
    ],
    [
      await f.request('PATCH', `/api/v1/issues/${a.id}`, { version: 1, deleted: true }),
      'HAS_CHILDREN',
    ],
  ];
  for (const [response, code] of failures) {
    assert.equal(response.data.error.code, code);
    assert.match(response.data.error.message, /\b(sub-)?tasks?\b/i);
    assert.doesNotMatch(response.data.error.message, /issue/i);
  }
});
t('pagination cursor is signed and filter-bound', async (f) => {
  for (let n = 0; n < 5; n++) await f.create({ title: `Page ${n}` });
  const first = (await f.request('GET', '/api/v1/issues?limit=2')).data;
  assert.equal(first.data.length, 2);
  assert(first.next_cursor);
  const second = (
    await f.request('GET', '/api/v1/issues?limit=2&cursor=' + encodeURIComponent(first.next_cursor))
  ).data;
  assert(second.data.every((i) => !first.data.some((j) => j.id === i.id)));
  assert.equal(
    (
      await f.request(
        'GET',
        '/api/v1/issues?q=changed&cursor=' + encodeURIComponent(first.next_cursor),
      )
    ).status,
    422,
  );
  assert.equal((await f.request('GET', '/api/v1/issues?cursor=bad')).status, 422);
});
t('search escapes wildcard characters', async (f) => {
  await f.create({ title: '100% ready' });
  await f.create({ title: '100 percent ready' });
  assert.equal((await f.request('GET', '/api/v1/issues?q=%25')).data.data.length, 1);
  assert.equal((await f.request('GET', "/api/v1/issues?q=' OR 1=1 --")).data.data.length, 0);
});
t('unknown filters and invalid pagination are rejected', async (f) => {
  assert.equal((await f.request('GET', '/api/v1/issues?limit=5000')).status, 422);
  assert.equal((await f.request('GET', '/api/v1/issues?workspace_id=other')).status, 422);
  assert.equal((await f.request('GET', '/api/v1/issues?archived=banana')).status, 422);
});
t('project membership and progress are consistent', async (f) => {
  const p = await f.request('POST', '/api/v1/projects', {
    name: 'Release',
    team_ids: [f.init.team_id],
    lead_id: f.init.user_id,
  });
  assert.equal(p.status, 201);
  assert.equal((await f.create({ project_id: p.data.id })).status, 201);
  assert.equal((await f.request('GET', '/api/v1/projects')).data[0].total, 1);
  assert.equal(
    (await f.request('POST', '/api/v1/projects', { name: 'Invalid', team_ids: [] })).status,
    422,
  );
});
t('milestones must belong to the selected project', async (f) => {
  const p = (await f.request('POST', '/api/v1/projects', { name: 'P', team_ids: [f.init.team_id] }))
      .data,
    m = (await f.request('POST', '/api/v1/milestones', { name: 'M', project_id: p.id })).data;
  assert.equal((await f.create({ milestone_id: m.id })).status, 422);
  assert.equal((await f.create({ project_id: p.id, milestone_id: m.id })).status, 201);
});
t('cycles validate date order and assignment', async (f) => {
  assert.equal(
    (
      await f.request('POST', '/api/v1/cycles', {
        name: 'Bad',
        team_id: f.init.team_id,
        start_date: '2026-10-01',
        end_date: '2026-09-01',
      })
    ).status,
    422,
  );
  const c = (
    await f.request('POST', '/api/v1/cycles', {
      name: 'Good',
      team_id: f.init.team_id,
      start_date: '2026-09-01',
      end_date: '2026-09-14',
    })
  ).data;
  assert.equal((await f.create({ cycle_id: c.id })).status, 201);
});
t('disabled modules reject API calls and core cannot be disabled', async (f) => {
  assert.equal(
    (await f.request('PATCH', '/api/v1/modules/tickets', { enabled: false })).status,
    422,
  );
  assert.equal(
    (await f.request('PATCH', '/api/v1/modules/cycles', { enabled: false })).status,
    200,
  );
  assert.equal((await f.request('GET', '/api/v1/cycles')).status, 409);
});
t('settings module catalog names the core module Tasks without issue wording', async (f) => {
  const { modules } = (await f.request('GET', '/api/v1/catalog')).data;
  const core = modules.find((m) => m.id === 'tickets');
  assert.equal(core.name, 'Tasks');
  assert.match(core.description, /^Tasks, epics/);
  // Only a qualified third-party noun ("GitHub issues") may remain.
  for (const m of modules)
    assert.doesNotMatch(`${m.name} ${m.description}`.replace(/GitHub issues/g, ''), /\bissues?\b/i);
});
t('saved view filters round trip and reject arbitrary SQL', async (f) => {
  assert.equal(
    (
      await f.request('POST', '/api/v1/views', {
        name: 'Mine',
        filters: { assignee_id: 'me' },
        shared: true,
      })
    ).status,
    201,
  );
  assert.equal((await f.request('GET', '/api/v1/views')).data[0].filters.assignee_id, 'me');
  assert.equal(
    (
      await f.request('POST', '/api/v1/views', {
        name: 'Bad',
        filters: { sql: 'DROP TABLE issues' },
      })
    ).status,
    422,
  );
});
t('single-use invites grant viewer permissions without escalation', async (f) => {
  const inv = (
    await f.request('POST', '/api/v1/invitations', { email: 'viewer@example.test', role: 'viewer' })
  ).data;
  const data = { token: inv.token, name: 'Reader', password: 'a-viewer-password' };
  assert.equal((await f.request('POST', '/api/auth/accept-invite', data)).status, 201);
  assert.equal((await f.request('POST', '/api/auth/accept-invite', data)).status, 410);
  const login = await f.request('POST', '/api/auth/login', {
    email: 'viewer@example.test',
    password: 'a-viewer-password',
  });
  f.setSession(login.headers.get('set-cookie').split(';')[0]);
  assert.equal((await f.create()).status, 403);
  assert.equal(
    (await f.request('POST', '/api/v1/tokens', { name: 'Escalate', scopes: ['admin'] })).status,
    403,
  );
});
t('last owner cannot be demoted', async (f) =>
  assert.equal(
    (await f.request('PATCH', `/api/v1/members/${f.init.user_id}`, { role: 'member' })).status,
    409,
  ),
);
t('PATs are hashed revocable and scope-limited', async (f) => {
  const token = (await f.request('POST', '/api/v1/tokens', { name: 'Read only', scopes: ['read'] }))
    .data;
  const stored = await f.db.transaction((tx) =>
    tx.one('SELECT * FROM api_tokens WHERE id=?', [token.id]),
  );
  assert.equal(stored.hash, sha256(token.token));
  const o = { anonymous: true, headers: { authorization: `Bearer ${token.token}` } };
  assert.equal((await f.request('GET', '/api/v1/issues', undefined, o)).status, 200);
  assert.equal(
    (await f.request('POST', '/api/v1/issues', { team_id: f.init.team_id, title: 'No write' }, o))
      .status,
    403,
  );
  await f.request('DELETE', '/api/v1/tokens/' + token.id);
  assert.equal((await f.request('GET', '/api/v1/me', undefined, o)).status, 401);
});
t('comment authors subscriptions and edit versions are tracked', async (f) => {
  const issue = (await f.create()).data,
    c = (await f.request('POST', `/api/v1/issues/${issue.id}/comments`, { body: '**Hello**' }))
      .data;
  assert.equal(c.author_id, f.init.user_id);
  assert.equal(
    (await f.request('PATCH', `/api/v1/comments/${c.id}`, { version: 1, body: 'Updated' })).status,
    200,
  );
  assert.equal(
    (await f.request('PATCH', `/api/v1/comments/${c.id}`, { version: 1, body: 'Stale' })).status,
    409,
  );
  const detail = (await f.request('GET', `/api/v1/issues/${issue.id}`)).data;
  assert.equal(detail.comments.length, 1);
  assert(detail.subscribed);
});
t('private attachment upload and download cannot overwrite existing objects', async (f) => {
  const issue = (await f.create()).data,
    bytes = Buffer.from('A private attachment');
  const r = (
    await f.request('POST', `/api/v1/issues/${issue.id}/attachments`, {
      filename: '../notes.txt',
      mime: 'text/plain',
      bytes: bytes.length,
    })
  ).data;
  const u = await f.request('PUT', r.upload_url, bytes, {
    raw: true,
    headers: { 'content-type': 'application/octet-stream' },
  });
  assert.equal(u.status, 201);
  assert.equal(u.data.filename, '.._notes.txt');
  assert.equal((await f.request('GET', r.upload_url)).data, bytes.toString());
  assert.equal((await f.request('GET', r.upload_url, undefined, { anonymous: true })).status, 401);
  assert.equal((await f.request('PUT', r.upload_url, bytes, { raw: true })).status, 409);
});
t('uploads reject oversized files and falsified MIME types', async (f) => {
  const issue = (await f.create()).data;
  assert.equal(
    (
      await f.request('POST', `/api/v1/issues/${issue.id}/attachments`, {
        filename: 'huge.txt',
        mime: 'text/plain',
        bytes: MAX_UPLOAD + 1,
      })
    ).status,
    413,
  );
  const r = (
    await f.request('POST', `/api/v1/issues/${issue.id}/attachments`, {
      filename: 'fake.png',
      mime: 'image/png',
      bytes: 3,
    })
  ).data;
  assert.equal(
    (await f.request('PUT', r.upload_url, Buffer.from('bad'), { raw: true })).status,
    415,
  );
  assert.throws(() => inspectFile(Buffer.from('<svg/>'), 'image/svg+xml'));
});
test('GitHub HMAC rejects tampering', () => {
  const raw = Buffer.from('{"event":1}');
  verifyGitHub(raw, 'sha256=' + hmac('secret', raw), 'secret');
  assert.throws(() => verifyGitHub(raw, 'sha256=bad', 'secret'));
});
test('Slack signature checks replay window', () => {
  const raw = Buffer.from('command=%2Ftickets'),
    time = Date.now(),
    ts = String(Math.floor(time / 1000)),
    sig = 'v0=' + hmac('secret', `v0:${ts}:${raw.toString()}`);
  verifySlack(raw, ts, sig, 'secret', time);
  assert.throws(() => verifySlack(raw, ts, sig, 'secret', time + 301000));
});
t(
  'GitHub webhook deduplication imports exactly one issue',
  async (f) => {
    f.env.INTEGRATIONS_WORKSPACE_ID = f.init.workspace_id;
    const raw = JSON.stringify({
        action: 'opened',
        repository: { id: 1, full_name: 'example/demo' },
        issue: {
          number: 42,
          title: 'Imported',
          body: 'From GitHub',
          html_url: 'https://github.com/example/demo/issues/42',
        },
      }),
      headers = {
        'x-hub-signature-256': 'sha256=' + hmac(f.env.GITHUB_WEBHOOK_SECRET, raw),
        'x-github-event': 'issues',
        'x-github-delivery': 'delivery-1',
      };
    assert.equal(
      (
        await f.request('POST', '/api/webhooks/github', raw, {
          raw: true,
          anonymous: true,
          headers,
        })
      ).status,
      202,
    );
    assert.equal(
      (
        await f.request('POST', '/api/webhooks/github', raw, {
          raw: true,
          anonymous: true,
          headers,
        })
      ).data.duplicate,
      true,
    );
    assert.equal((await runWorker(f.db, f.env)).processed, 1);
    assert.equal((await f.request('GET', '/api/v1/issues')).data.data.length, 1);
  },
  { GITHUB_REPOSITORY: 'example/demo', GITHUB_WEBHOOK_SECRET: 'gh-secret' },
);
t(
  'closed unmerged PR does not complete a linked issue',
  async (f) => {
    f.env.INTEGRATIONS_WORKSPACE_ID = f.init.workspace_id;
    const issue = (await f.create()).data,
      done = f.catalog.statuses.find((s) => s.category === 'completed');
    await f.request('PATCH', '/api/v1/integrations/github', { done_status_id: done.id });
    const raw = JSON.stringify({
      action: 'closed',
      repository: { full_name: 'example/demo' },
      pull_request: {
        number: 7,
        title: `Fix ${issue.key}`,
        head: { ref: 'main' },
        html_url: 'https://github.com/example/demo/pull/7',
        merged: false,
      },
    });
    await f.request('POST', '/api/webhooks/github', raw, {
      raw: true,
      anonymous: true,
      headers: {
        'x-hub-signature-256': 'sha256=' + hmac(f.env.GITHUB_WEBHOOK_SECRET, raw),
        'x-github-event': 'pull_request',
        'x-github-delivery': 'pr-7',
      },
    });
    await runWorker(f.db, f.env);
    assert.equal(
      (await f.request('GET', '/api/v1/issues/' + issue.id)).data.status_id,
      issue.status_id,
    );
  },
  { GITHUB_REPOSITORY: 'example/demo', GITHUB_WEBHOOK_SECRET: 'gh-secret' },
);
t('unconfigured integrations fail closed', async (f) =>
  assert.equal(
    (await f.request('POST', '/api/webhooks/github', '{}', { anonymous: true, raw: true })).status,
    503,
  ),
);
