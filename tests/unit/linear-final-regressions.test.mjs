import { test, expect } from 'bun:test';
import { configured } from './linear-live-queue.test.mjs';
import { queueNativeLinearChange } from '../../packages/server/core/linear-events.mjs';
import {
  claimSyncJob,
  finishSyncJob,
  enqueueSyncJob,
} from '../../packages/server/modules/linear-live/store.mjs';
import { reconcileEntityJob } from '../../packages/server/modules/linear-live/engine.mjs';
import { normalizedSource } from '../../packages/server/modules/linear-live/model.mjs';

test('rapid native revisions coalesce while an edit during processing survives acknowledgement', async () => {
  const { f, actor, env, config } = await configured();
  try {
    const id = crypto.randomUUID();
    for (let revision = 1; revision <= 10; revision++)
      await f.db.transaction((tx) => queueNativeLinearChange(tx, actor, 'documents', id, revision));
    let rows = await f.db.transaction((tx) =>
      tx.all("SELECT * FROM outbox WHERE provider='linear' AND event='entity'"),
    );
    expect(rows).toHaveLength(1);
    const claimed = await claimSyncJob(f.db, env, rows[0].id, config.generation);
    expect(claimed).not.toBeNull();
    await f.db.transaction((tx) => queueNativeLinearChange(tx, actor, 'documents', id, 11));
    await f.db.transaction((tx) => finishSyncJob(tx, claimed, { ok: true }));
    rows = await f.db.transaction((tx) =>
      tx.all("SELECT * FROM outbox WHERE provider='linear' AND event='entity'"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
    const again = await claimSyncJob(f.db, env, rows[0].id, config.generation);
    expect(again).not.toBeNull();
    await f.db.transaction((tx) => finishSyncJob(tx, again, { ok: true }));
    expect(
      (await f.db.transaction((tx) => tx.one('SELECT status FROM outbox WHERE id=?', [again.id])))
        .status,
    ).toBe('done');
  } finally {
    await f.close();
  }
});
test('unknown source project status is a classified error rather than undefined data', () => {
  for (const status of [null, { type: 'invented' }])
    expect(() =>
      normalizedSource(
        'projects',
        { name: 'A', description: '', status, teams: { nodes: [] } },
        () => null,
      ),
    ).toThrow();
});
test('source-create retry recovers from a concurrent native document title edit without duplicates', async () => {
  const { f, source, actor, env, config } = await configured();
  try {
    const native = (
      await f.request('POST', '/api/v1/documents', {
        title: 'Original title',
        body: 'Original body',
      })
    ).data;
    let record = null,
      creates = 0;
    const fetcher = async (_url, options) => {
      const { query, variables } = JSON.parse(options.body);
      if (query.includes('SyncOrganization'))
        return Response.json({ data: { organization: { id: source.ids.org } } });
      if (query.includes('SyncFind'))
        return Response.json({ data: { documents: { nodes: record ? [record] : [] } } });
      if (query.includes('documentCreate')) {
        creates++;
        record = {
          id: native.id,
          title: variables.input.title,
          content: variables.input.content,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          archivedAt: null,
          project: null,
          initiative: null,
          creator: { id: source.ids.user },
        };
        expect(
          (
            await f.request('PATCH', '/api/v1/documents/' + native.id, {
              version: 1,
              title: 'Concurrent title',
            })
          ).status,
        ).toBe(200);
        return Response.json({ data: { documentCreate: { success: true, document: record } } });
      }
      if (query.includes('SyncEntity')) return Response.json({ data: { document: record } });
      if (query.includes('documentUpdate')) {
        Object.assign(record, {
          title: variables.input.title ?? record.title,
          content: variables.input.content ?? record.content,
          updatedAt: '2026-01-02T00:00:00Z',
        });
        return Response.json({ data: { documentUpdate: { success: true, document: record } } });
      }
      throw Error('Unexpected query ' + query.slice(0, 60));
    };
    const job = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        {
          kind: 'entity',
          side: 'native',
          collection: 'documents',
          sourceId: native.id,
          targetId: native.id,
        },
        'create-race',
      ),
    );
    await reconcileEntityJob(f.db, env, job.id, config.generation, { fetcher });
    await f.db.transaction((tx) =>
      tx.exec("UPDATE outbox SET next_attempt_at='2000-01-01T00:00:00Z' WHERE id=?", [job.id]),
    );
    const retried = await reconcileEntityJob(f.db, env, job.id, config.generation, { fetcher });
    expect(retried.status).toBe('exported');
    expect(creates).toBe(1);
    expect((await f.request('GET', '/api/v1/documents/' + native.id)).data.title).toBe(
      'Concurrent title',
    );
    const mapping = await f.db.transaction((tx) =>
      tx.one(
        'SELECT target_id FROM linear_source_map WHERE workspace_id=? AND collection=? AND source_id=?',
        [actor.workspace_id, 'documents', native.id],
      ),
    );
    expect(mapping.target_id).toBe(native.id);
    const follow = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        {
          kind: 'entity',
          side: 'native',
          collection: 'documents',
          sourceId: native.id,
          targetId: native.id,
        },
        'after-create-race',
      ),
    );
    const converged = await reconcileEntityJob(f.db, env, follow.id, config.generation, {
      fetcher,
    });
    expect(converged.status).toBe('converged');
    expect(record.title).toBe('Concurrent title');
    expect(creates).toBe(1);
  } finally {
    await f.close();
  }
});

test('a new edit after completion publishes a new queue idempotency key even in the same minute', async () => {
  const { f, actor, env, config } = await configured();
  const { dispatchLinearJobs } =
    await import('../../packages/server/modules/linear-live/dispatch.mjs');
  try {
    const id = crypto.randomUUID(),
      keys = [];
    const options = {
      send: async (_topic, _message, settings) => keys.push(settings.idempotencyKey),
    };
    await f.db.transaction((tx) => queueNativeLinearChange(tx, actor, 'documents', id, 1));
    await dispatchLinearJobs(f.db, env, options);
    const job = await f.db.transaction((tx) =>
      tx.one("SELECT id FROM outbox WHERE provider='linear' AND event='entity'"),
    );
    const claim = await claimSyncJob(f.db, env, job.id, config.generation);
    await f.db.transaction((tx) => finishSyncJob(tx, claim, { ok: true }));
    await f.db.transaction((tx) => queueNativeLinearChange(tx, actor, 'documents', id, 2));
    await dispatchLinearJobs(f.db, env, options);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  } finally {
    await f.close();
  }
});
