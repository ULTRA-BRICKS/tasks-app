import { test, expect } from 'bun:test';
import assert from 'node:assert/strict';
import { configured } from './linear-live-queue.test.mjs';
import {
  configureSync,
  readSyncConfig,
  enqueueSyncJob,
} from '../../packages/server/modules/linear-live/store.mjs';
import { dispatchLinearJobs } from '../../packages/server/modules/linear-live/dispatch.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';

test('a self-hosted writer records its explicit deployment identity and fences the previous writer', async () => {
  const c = await configured();
  try {
    const env = {
      ...c.env,
      VERCEL_DEPLOYMENT_ID: undefined,
      TASKS_DEPLOYMENT_ID: 'k3s-release-test',
    };
    const next = await c.f.db.transaction((tx) =>
      configureSync(tx, c.actor, { organizationId: c.source.ids.org, enabled: true }, env),
    );
    expect(next.deploymentId).toBe('k3s-release-test');
    await assert.rejects(
      c.f.db.transaction((tx) => readSyncConfig(tx, c.env)),
      /active synchronization writer/,
    );
    expect((await c.f.db.transaction((tx) => readSyncConfig(tx, env))).deploymentId).toBe(
      'k3s-release-test',
    );
    await assert.rejects(
      c.f.db.transaction((tx) =>
        configureSync(
          tx,
          c.actor,
          { organizationId: c.source.ids.org, enabled: true },
          { ...env, VERCEL_DEPLOYMENT_ID: 'another-writer' },
        ),
      ),
      /deployment identity/i,
    );
  } finally {
    await c.f.close();
  }
});
test('PostgreSQL queue mode leaves durable work pending without invoking a Vercel broker', async () => {
  const c = await configured();
  try {
    const q = await c.f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        c.actor.workspace_id,
        { kind: 'entity', collection: 'issues', sourceId: c.source.ids.issue, side: 'source' },
        'postgres-queue',
      ),
    );
    let publishes = 0;
    const result = await dispatchLinearJobs(
      c.f.db,
      { ...c.env, LINEAR_QUEUE_DRIVER: 'postgres' },
      {
        send: async () => {
          publishes++;
        },
      },
    );
    expect(publishes).toBe(0);
    expect(result.sent).toBe(0);
    expect(
      (await c.f.db.transaction((tx) => tx.one('SELECT status FROM outbox WHERE id=?', [q.id])))
        .status,
    ).toBe('pending');
  } finally {
    await c.f.close();
  }
});
test('the self-hosted tick uses the ordinary lease and domain merge, honors backoff and inactive writers', async () => {
  const { runPostgresLinearTick } =
    await import('../../packages/server/modules/linear-live/postgres-worker.mjs');
  const c = await configured();
  try {
    const env = { ...c.env, LINEAR_QUEUE_DRIVER: 'postgres' };
    const q = await c.f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        c.actor.workspace_id,
        { kind: 'entity', collection: 'issues', sourceId: c.source.ids.issue, side: 'source' },
        'postgres-tick',
      ),
    );
    const remote = {
      ...c.source.data.issues.find((r) => r.id === c.source.ids.issue),
      priority: 1,
      updatedAt: '2026-10-21T12:00:00.000Z',
    };
    let calls = 0;
    const fetcher = async (_url, options) => {
      calls++;
      return Response.json({
        data: JSON.parse(options.body).query.includes('SyncOrganization')
          ? { organization: { id: c.source.ids.org } }
          : { issue: remote },
      });
    };
    const result = await runPostgresLinearTick(c.f.db, env, { fetcher, limit: 1 });
    expect(result.processed).toBe(1);
    const nativeId = targetId(c.actor.workspace_id, c.source.ids.org, 'issues', c.source.ids.issue);
    expect((await c.f.request('GET', '/api/v1/issues/' + nativeId)).data.priority).toBe(1);
    expect(
      (await c.f.db.transaction((tx) => tx.one('SELECT status FROM outbox WHERE id=?', [q.id])))
        .status,
    ).toBe('done');
    const count = calls;
    expect(
      (await runPostgresLinearTick(c.f.db, { ...env, VERCEL_DEPLOYMENT_ID: 'old' }, { fetcher }))
        .status,
    ).toBe('inactive');
    expect(calls).toBe(count);
    const waiting = await c.f.db.transaction(async (tx) => {
      const row = await enqueueSyncJob(
        tx,
        c.actor.workspace_id,
        { kind: 'entity', collection: 'issues', sourceId: c.source.ids.issue, side: 'source' },
        'future-backoff',
      );
      await tx.exec('UPDATE outbox SET next_attempt_at=? WHERE id=?', [
        '2099-01-01T00:00:00.000Z',
        row.id,
      ]);
      return row;
    });
    expect((await runPostgresLinearTick(c.f.db, env, { fetcher })).processed).toBe(0);
    expect(
      (
        await c.f.db.transaction((tx) =>
          tx.one('SELECT status FROM outbox WHERE id=?', [waiting.id]),
        )
      ).status,
    ).toBe('pending');
    expect(calls).toBe(count);
  } finally {
    await c.f.close();
  }
});

test('daily reconciliation is durable across worker restarts and stale deployments cannot schedule it', async () => {
  const { scheduleDailyReconciliation } =
    await import('../../packages/server/modules/linear-live/postgres-worker.mjs');
  const c = await configured();
  try {
    const env = { ...c.env, LINEAR_QUEUE_DRIVER: 'postgres' };
    const stamp = Date.parse('2026-10-21T12:00:00.000Z');
    const first = await scheduleDailyReconciliation(c.f.db, env, stamp);
    expect(first.scheduled).toBeGreaterThan(0);
    expect((await scheduleDailyReconciliation(c.f.db, env, stamp + 3600000)).scheduled).toBe(0);
    const inactive = await scheduleDailyReconciliation(
      c.f.db,
      { ...env, VERCEL_DEPLOYMENT_ID: 'old' },
      stamp + 86400000,
    );
    expect(inactive.scheduled).toBe(0);
    expect((await scheduleDailyReconciliation(c.f.db, env, stamp + 86400000)).scheduled).toBe(
      first.scheduled,
    );
  } finally {
    await c.f.close();
  }
});

test('daily scheduling is serialized and each UTC day owns distinct jobs', async () => {
  const { scheduleDailyReconciliation } =
    await import('../../packages/server/modules/linear-live/postgres-worker.mjs');
  const c = await configured();
  try {
    const env = { ...c.env, LINEAR_QUEUE_DRIVER: 'postgres' };
    const time = Date.parse('2026-10-22T10:00:00.000Z');
    const results = await Promise.all([
      scheduleDailyReconciliation(c.f.db, env, time),
      scheduleDailyReconciliation(c.f.db, env, time),
    ]);
    const count = results.reduce((sum, item) => sum + item.scheduled, 0);
    expect(count).toBeGreaterThan(0);
    expect(results.filter((item) => item.scheduled > 0)).toHaveLength(1);
    expect((await scheduleDailyReconciliation(c.f.db, env, time - 86400000)).scheduled).toBe(0);
    expect((await scheduleDailyReconciliation(c.f.db, env, time + 86400000)).scheduled).toBe(count);
    const rows = await c.f.db.transaction((tx) =>
      tx.all(
        "SELECT id,payload FROM outbox WHERE workspace_id=? AND event='scan' AND provider='linear'",
        [c.actor.workspace_id],
      ),
    );
    expect(rows).toHaveLength(count * 2);
    expect(new Set(rows.map((row) => JSON.parse(row.payload).pass)).size).toBe(2);
  } finally {
    await c.f.close();
  }
});

test('a failed daily receipt rolls back its jobs and allows a complete retry', async () => {
  const { scheduleDailyReconciliation } =
    await import('../../packages/server/modules/linear-live/postgres-worker.mjs');
  const c = await configured();
  try {
    const env = { ...c.env, LINEAR_QUEUE_DRIVER: 'postgres' };
    const broken = {
      transaction: (fn) =>
        c.f.db.transaction((tx) =>
          fn({
            ...tx,
            exec: (sql, args) => {
              if (sql.includes("'entity-state'")) throw Error('synthetic receipt failure');
              return tx.exec(sql, args);
            },
          }),
        ),
    };
    await assert.rejects(
      scheduleDailyReconciliation(broken, env, Date.parse('2026-10-22T12:00:00Z')),
      /synthetic receipt failure/,
    );
    expect(
      await c.f.db.transaction((tx) =>
        tx.all("SELECT id FROM outbox WHERE workspace_id=? AND event='scan'", [
          c.actor.workspace_id,
        ]),
      ),
    ).toHaveLength(0);
    expect(
      (await scheduleDailyReconciliation(c.f.db, env, Date.parse('2026-10-22T12:00:00Z')))
        .scheduled,
    ).toBeGreaterThan(0);
  } finally {
    await c.f.close();
  }
});

test('an unexpected job failure does not starve later jobs in the same batch', async () => {
  const { runPostgresLinearTick } =
    await import('../../packages/server/modules/linear-live/postgres-worker.mjs');
  const c = await configured();
  try {
    const env = { ...c.env, LINEAR_QUEUE_DRIVER: 'postgres' };
    const job = {
      kind: 'entity',
      collection: 'issues',
      sourceId: c.source.ids.issue,
      side: 'source',
    };
    await c.f.db.transaction(async (tx) => {
      await enqueueSyncJob(tx, c.actor.workspace_id, job, 'first');
      await enqueueSyncJob(tx, c.actor.workspace_id, { ...job, side: 'target' }, 'second');
    });
    let calls = 0;
    const fetcher = async () => {
      calls++;
      throw new RangeError('synthetic unexpected failure');
    };
    const result = await runPostgresLinearTick(c.f.db, env, { fetcher, limit: 5 });
    expect(result.processed + result.retrying + result.failed).toBeGreaterThanOrEqual(2);
    expect(calls).toBeGreaterThanOrEqual(2);
  } finally {
    await c.f.close();
  }
});
