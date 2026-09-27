import { test, expect } from 'bun:test';
import { configured } from './linear-live-queue.test.mjs';
import { normalizedNative } from '../../packages/server/modules/linear-live/context.mjs';
import {
  enqueueSyncJob,
  claimSyncJob,
  failSyncJob,
} from '../../packages/server/modules/linear-live/store.mjs';
import { AppError } from '../../packages/server/core/errors.mjs';

test('related endpoints are an unordered pair without changing stored native rows', () => {
  const row = {
    source_id: 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb',
    target_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    type: 'related',
  };
  const before = { ...row };
  expect(normalizedNative('issueRelations', row, ['source_id', 'target_id', 'type'])).toEqual({
    source_id: row.target_id,
    target_id: row.source_id,
    type: 'related',
  });
  expect(row).toEqual(before);
  for (const type of ['blocks', 'duplicates'])
    expect(
      normalizedNative('issueRelations', { ...row, type }, ['source_id', 'target_id', 'type']),
    ).toEqual({ ...row, type });
});
for (const code of ['SYNC_BACKPRESSURE', 'SOURCE_RATE_LIMITED'])
  test(
    code + ' postpones rather than exhausting scan retries while no progress is possible',
    async () => {
      const { f, actor, env, config } = await configured();
      try {
        const job = await f.db.transaction((tx) =>
          enqueueSyncJob(
            tx,
            actor.workspace_id,
            { kind: 'scan', collection: 'issues', side: 'source', cursor: 'saved-cursor' },
            'backpressure-test',
          ),
        );
        await f.db.transaction((tx) =>
          tx.exec('UPDATE outbox SET attempts=8 WHERE id=?', [job.id]),
        );
        const claim = await claimSyncJob(f.db, env, job.id, config.generation);
        expect(claim).not.toBeNull();
        await failSyncJob(
          f.db,
          claim,
          Object.assign(new AppError(429, code, 'Synthetic capacity pause'), {
            retryAfterSeconds: 30,
          }),
        );
        const stored = await f.db.transaction((tx) =>
          tx.one('SELECT status,payload,last_error FROM outbox WHERE id=?', [job.id]),
        );
        expect(stored.status).toBe('pending');
        expect(stored.last_error).toBe(code);
        expect(JSON.parse(stored.payload).cursor).toBe('saved-cursor');
      } finally {
        await f.close();
      }
    },
  );

test('an imported related relation in reverse storage order is a no-op, not an outbound mutation', async () => {
  const { f, source, actor, env, config } = await configured();
  try {
    const { reconcileEntityJob } =
      await import('../../packages/server/modules/linear-live/engine.mjs');
    const { targetId } = await import('../../packages/imports/linear-source.mjs');
    const record = source.data.issueRelations[0],
      tid = targetId(actor.workspace_id, source.ids.org, 'issueRelations', record.id);
    const before = await f.db.transaction((tx) =>
      tx.one('SELECT * FROM relations WHERE workspace_id=? AND id=?', [actor.workspace_id, tid]),
    );
    await f.db.transaction((tx) =>
      tx.exec('UPDATE relations SET source_id=?,target_id=? WHERE workspace_id=? AND id=?', [
        before.target_id,
        before.source_id,
        actor.workspace_id,
        tid,
      ]),
    );
    const stored = await f.db.transaction((tx) =>
      tx.one('SELECT * FROM relations WHERE workspace_id=? AND id=?', [actor.workspace_id, tid]),
    );
    const job = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        { kind: 'entity', collection: 'issueRelations', sourceId: record.id, side: 'source' },
        'relation-order',
      ),
    );
    const result = await reconcileEntityJob(f.db, env, job.id, config.generation, {
      fetcher: async (_url, options) => {
        const q = JSON.parse(options.body).query;
        if (q.includes('SyncOrganization'))
          return Response.json({ data: { organization: { id: source.ids.org } } });
        if (q.includes('SyncEntity') && q.includes('issueRelation('))
          return Response.json({ data: { issueRelation: record } });
        if (q.includes('SyncEntity') && q.includes('issue('))
          return Response.json({
            data: { issue: source.data.issues.find((r) => r.id === record.issue.id) },
          });
        throw Error('Unexpected source write or fetch');
      },
    });
    expect(result.status).toBe('converged');
    expect(
      await f.db.transaction((tx) =>
        tx.one('SELECT * FROM relations WHERE workspace_id=? AND id=?', [actor.workspace_id, tid]),
      ),
    ).toEqual(stored);
  } finally {
    await f.close();
  }
});

test('a queued native job adopts the source mapping created after enqueue before acquiring its entity lease', async () => {
  const { f, source, actor, env, config } = await configured();
  try {
    const { targetId } = await import('../../packages/imports/linear-source.mjs');
    const nativeId = targetId(actor.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const job = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        {
          kind: 'entity',
          collection: 'issues',
          side: 'native',
          sourceId: nativeId,
          targetId: nativeId,
        },
        'late-binding',
      ),
    );
    const claimed = await claimSyncJob(f.db, env, job.id, config.generation);
    expect(claimed.data.sourceId).toBe(source.ids.issue);
    expect(claimed.data.targetId).toBe(nativeId);
    const sourceJob = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        { kind: 'entity', collection: 'issues', side: 'source', sourceId: source.ids.issue },
        'source-same-object',
      ),
    );
    expect(await claimSyncJob(f.db, env, sourceJob.id, config.generation)).toBeNull();
  } finally {
    await f.close();
  }
});

test('capacity pauses do not consume the later transient-failure budget', async () => {
  const { f, actor, env, config } = await configured();
  try {
    const job = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        { kind: 'scan', collection: 'issues', side: 'source', _capacityPauses: 8 },
        'capacity-budget',
      ),
    );
    await f.db.transaction((tx) => tx.exec('UPDATE outbox SET attempts=8 WHERE id=?', [job.id]));
    const claimed = await claimSyncJob(f.db, env, job.id, config.generation);
    await failSyncJob(f.db, claimed, Error('First real transient failure after quota returned'));
    expect(
      (await f.db.transaction((tx) => tx.one('SELECT status FROM outbox WHERE id=?', [job.id])))
        .status,
    ).toBe('pending');
  } finally {
    await f.close();
  }
});

test('a capacity-paused native job gets a fresh durable queue dispatch identity', async () => {
  const { f, actor, source, env, config } = await configured();
  try {
    const { enqueueNativeSyncJob } =
      await import('../../packages/server/modules/linear-live/store.mjs');
    const { dispatchLinearJobs } =
      await import('../../packages/server/modules/linear-live/dispatch.mjs');
    const job = await f.db.transaction((tx) =>
      enqueueNativeSyncJob(tx, actor.workspace_id, {
        kind: 'entity',
        side: 'native',
        collection: 'issues',
        sourceId: source.ids.issue,
        revision: 1,
      }),
    );
    const sent = [];
    const send = async (_topic, _message, options) => {
      sent.push(options.idempotencyKey);
    };
    await dispatchLinearJobs(f.db, env, { send });
    expect(sent).toHaveLength(1);
    const claimed = await claimSyncJob(f.db, env, job.id, config.generation);
    await failSyncJob(
      f.db,
      claimed,
      Object.assign(Error('Quota pause'), { code: 'SOURCE_RATE_LIMITED', retryAfterSeconds: 30 }),
    );
    await f.db.transaction((tx) =>
      tx.exec("UPDATE outbox SET next_attempt_at='2000-01-01T00:00:00Z' WHERE id=?", [job.id]),
    );
    await dispatchLinearJobs(f.db, env, { send });
    expect(sent).toHaveLength(2);
    expect(sent[1]).not.toBe(sent[0]);
  } finally {
    await f.close();
  }
});
