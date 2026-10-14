import assert from 'node:assert/strict';
import { test, expect } from 'bun:test';
import { configured } from './linear-live-queue.test.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';
import { claimSyncJob, enqueueSyncJob } from '../../packages/server/modules/linear-live/store.mjs';
import {
  planMigrationNotices,
  applyMigrationNotice,
} from '../../packages/server/modules/linear-live/notice-backfill.mjs';
import {
  createMigrationNotice,
  readMigrationNotice,
} from '../../packages/server/modules/linear-live/migration-notice.mjs';
import { reconcileEntityJob } from '../../packages/server/modules/linear-live/engine.mjs';
const ORIGIN = 'https://tasks-ultrabricks.vercel.app';
function sourceServer(c) {
  const state = {
    record: { ...c.source.data.issues.find((r) => r.id === c.source.ids.issue) },
    writes: 0,
  };
  state.fetcher = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    if (query.includes('SyncOrganization'))
      return Response.json({ data: { organization: { id: c.source.ids.org } } });
    if (query.includes('MigrationNoticeWrite')) {
      state.writes++;
      expect(Object.keys(variables.input)).toEqual(['description']);
      state.record = {
        ...state.record,
        description: variables.input.description,
        updatedAt: '2026-10-13T22:00:00.000Z',
      };
      return Response.json({ data: { issueUpdate: { success: true, issue: state.record } } });
    }
    if (query.includes('SyncEntity')) return Response.json({ data: { issue: state.record } });
    throw Error('Unexpected test source operation');
  };
  return state;
}
test('backfill is read-only until explicit apply and rejects a non-admin actor', async () => {
  const c = await configured();
  try {
    const env = { ...c.env, APP_URL: ORIGIN };
    const before = await c.f.db.transaction((tx) => tx.one('SELECT COUNT(*) AS n FROM outbox'));
    const plan = await c.f.db.transaction((tx) =>
      planMigrationNotices(tx, c.actor, env, { limit: 1, apply: false }),
    );
    expect(plan.planned).toHaveLength(1);
    expect(plan.nextCursor).toBeTruthy();
    expect((await c.f.db.transaction((tx) => tx.one('SELECT COUNT(*) AS n FROM outbox'))).n).toBe(
      before.n,
    );
    await assert.rejects(
      c.f.db.transaction((tx) =>
        planMigrationNotices(tx, { ...c.actor, role: 'member', scopes: ['read', 'write'] }, env, {
          apply: true,
          passId: crypto.randomUUID(),
        }),
      ),
    );
  } finally {
    await c.f.close();
  }
});
test('a notice is applied once, source business fields and all native fields are retained', async () => {
  const c = await configured();
  try {
    const env = { ...c.env, APP_URL: ORIGIN },
      passId = crypto.randomUUID();
    const plan = await c.f.db.transaction((tx) =>
      planMigrationNotices(tx, c.actor, env, { limit: 50, apply: true, passId }),
    );
    const selected = plan.planned.find((r) => r.sourceId === c.source.ids.issue);
    const job = await claimSyncJob(c.f.db, env, selected.jobId, c.config.generation);
    const nativeId = targetId(c.config.workspaceId, c.source.ids.org, 'issues', c.source.ids.issue);
    const before = (await c.f.request('GET', '/api/v1/issues/' + nativeId)).data;
    const upstream = sourceServer(c),
      original = upstream.record.description;
    const result = await applyMigrationNotice(c.f.db, env, job, { fetcher: upstream.fetcher });
    expect(result.marked).toBe(true);
    expect(upstream.writes).toBe(1);
    const decoded = readMigrationNotice(upstream.record.description, {
      appOrigin: ORIGIN,
      sourceId: c.source.ids.issue,
      targetId: nativeId,
      organizationId: c.source.ids.org,
      secret: env.LINEAR_WEBHOOK_SECRET,
    });
    expect(decoded.body).toBe(original);
    expect(decoded.notice.code).toBe(before.key);
    const after = (await c.f.request('GET', '/api/v1/issues/' + nativeId)).data;
    expect(after.version).toBe(before.version);
    expect(after.description).toBe(before.description);
    expect(after.title).toBe(before.title);
    const second = await c.f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        c.config.workspaceId,
        {
          kind: 'entity',
          collection: 'issues',
          sourceId: c.source.ids.issue,
          targetId: nativeId,
          action: 'migration-notice',
          side: 'source',
        },
        'repeat-notice',
      ),
    );
    const claimed = await claimSyncJob(c.f.db, env, second.id, c.config.generation);
    expect(
      (await applyMigrationNotice(c.f.db, env, claimed, { fetcher: upstream.fetcher })).marked,
    ).toBe(true);
    expect(upstream.writes).toBe(1);
  } finally {
    await c.f.close();
  }
});
test('a notice-only source event leaves native version unchanged, while real edits alongside it still apply', async () => {
  const c = await configured();
  try {
    const env = { ...c.env, APP_URL: ORIGIN },
      nativeId = targetId(c.config.workspaceId, c.source.ids.org, 'issues', c.source.ids.issue),
      upstream = sourceServer(c);
    const original = (await c.f.request('GET', '/api/v1/issues/' + nativeId)).data;
    const ctx = {
      appOrigin: ORIGIN,
      sourceId: c.source.ids.issue,
      targetId: nativeId,
      organizationId: c.source.ids.org,
      code: original.key,
      secret: env.LINEAR_WEBHOOK_SECRET,
    };
    upstream.record.description = createMigrationNotice(original.description, ctx);
    upstream.record.updatedAt = '2026-10-13T22:00:00.000Z';
    const queued = await c.f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        c.config.workspaceId,
        { kind: 'entity', collection: 'issues', sourceId: c.source.ids.issue, side: 'source' },
        'notice-only',
      ),
    );
    expect(
      (
        await reconcileEntityJob(c.f.db, env, queued.id, c.config.generation, {
          fetcher: upstream.fetcher,
        })
      ).status,
    ).toBe('converged');
    expect((await c.f.request('GET', '/api/v1/issues/' + nativeId)).data.version).toBe(
      original.version,
    );
    upstream.record = {
      ...upstream.record,
      description: createMigrationNotice('A real business edit', ctx),
      priority: 4,
      updatedAt: '2026-10-13T22:01:00.000Z',
    };
    const edited = await c.f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        c.config.workspaceId,
        { kind: 'entity', collection: 'issues', sourceId: c.source.ids.issue, side: 'source' },
        'notice-with-edit',
      ),
    );
    expect(
      (
        await reconcileEntityJob(c.f.db, env, edited.id, c.config.generation, {
          fetcher: upstream.fetcher,
        })
      ).status,
    ).toBe('converged');
    const after = (await c.f.request('GET', '/api/v1/issues/' + nativeId)).data;
    expect(after.description).toBe('A real business edit');
    expect(after.priority).toBe(4);
    expect(after.version).toBe(original.version + 1);
  } finally {
    await c.f.close();
  }
});

test('successful business synchronization does not hide a failed migration notice', async () => {
  const c = await configured();
  try {
    const env = { ...c.env, APP_URL: ORIGIN };
    const nativeId = targetId(c.config.workspaceId, c.source.ids.org, 'issues', c.source.ids.issue);
    const notice = await c.f.db.transaction(async (tx) => {
      const row = await enqueueSyncJob(
        tx,
        c.config.workspaceId,
        {
          kind: 'entity',
          collection: 'issues',
          sourceId: c.source.ids.issue,
          targetId: nativeId,
          action: 'migration-notice',
          side: 'source',
        },
        'notice-failed',
      );
      await tx.exec(
        "UPDATE outbox SET status='blocked',last_error='NOTICE_READBACK_MISMATCH' WHERE id=?",
        [row.id],
      );
      return row;
    });
    const real = await c.f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        c.config.workspaceId,
        {
          kind: 'entity',
          collection: 'issues',
          sourceId: c.source.ids.issue,
          targetId: nativeId,
          side: 'source',
        },
        'real-converged',
      ),
    );
    expect(
      (
        await reconcileEntityJob(c.f.db, env, real.id, c.config.generation, {
          fetcher: sourceServer(c).fetcher,
        })
      ).status,
    ).toBe('converged');
    const remains = await c.f.db.transaction((tx) =>
      tx.one('SELECT status,last_error FROM outbox WHERE id=?', [notice.id]),
    );
    expect(remains.status).toBe('blocked');
    expect(remains.last_error).toBe('NOTICE_READBACK_MISMATCH');
  } finally {
    await c.f.close();
  }
});

for (const wrong of ['organizationId', 'targetId', 'code']) {
  test(`a signed notice with mismatched ${wrong} cannot enter business reconciliation`, async () => {
    const c = await configured();
    try {
      const env = { ...c.env, APP_URL: ORIGIN };
      const nativeId = targetId(
        c.config.workspaceId,
        c.source.ids.org,
        'issues',
        c.source.ids.issue,
      );
      const before = (await c.f.request('GET', '/api/v1/issues/' + nativeId)).data;
      const upstream = sourceServer(c);
      const identity = {
        appOrigin: ORIGIN,
        organizationId: c.source.ids.org,
        sourceId: c.source.ids.issue,
        targetId: nativeId,
        code: before.key,
        secret: env.LINEAR_WEBHOOK_SECRET,
      };
      identity[wrong] = wrong === 'code' ? 'SRC-9999' : crypto.randomUUID();
      upstream.record.description = createMigrationNotice(
        'Do not import this unmatched body',
        identity,
      );
      upstream.record.updatedAt = '2026-10-14T19:00:00.000Z';
      const queued = await c.f.db.transaction((tx) =>
        enqueueSyncJob(
          tx,
          c.config.workspaceId,
          { kind: 'entity', collection: 'issues', sourceId: c.source.ids.issue, side: 'source' },
          'mismatched-notice-' + wrong,
        ),
      );
      const result = await reconcileEntityJob(c.f.db, env, queued.id, c.config.generation, {
        fetcher: upstream.fetcher,
      });
      expect(result.status).toBe('failed');
      const after = (await c.f.request('GET', '/api/v1/issues/' + nativeId)).data;
      expect(after.description).toBe(before.description);
      expect(after.version).toBe(before.version);
      expect(upstream.writes).toBe(0);
    } finally {
      await c.f.close();
    }
  });
}

test('authenticated HTTP backfill apply returns its committed queue receipt, not a post-commit 500', async () => {
  const c = await configured();
  try {
    const { createApp } = await import('../../packages/server/app.mjs');
    const app = createApp({ db: c.f.db, env: c.env, logger: { error() {} } });
    const response = await app.fetch(
      new Request(c.env.APP_URL + '/api/v1/sync/linear/migration-notices', {
        method: 'POST',
        headers: {
          cookie: c.f.session,
          origin: c.env.APP_URL,
          'x-tickets-csrf': '1',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ apply: true, passId: crypto.randomUUID(), limit: 50 }),
      }),
    );
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.applied).toBe(true);
    expect(result.planned.length).toBeGreaterThan(0);
    for (const planned of result.planned) {
      const row = await c.f.db.transaction((tx) =>
        tx.one('SELECT status,payload FROM outbox WHERE id=?', [planned.jobId]),
      );
      expect(row.status).toBe('pending');
      expect(JSON.parse(row.payload).action).toBe('migration-notice');
    }
  } finally {
    await c.f.close();
  }
});
