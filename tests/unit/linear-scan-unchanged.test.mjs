import { test, expect } from 'bun:test';
import { configured } from './linear-live-queue.test.mjs';
import { scanRecordIsUnchanged } from '../../packages/server/modules/linear-live/scan-unchanged.mjs';
import { loadNative } from '../../packages/server/modules/linear-live/context.mjs';
import { writeEntityState } from '../../packages/server/modules/linear-live/store.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';
async function check(f, config, record, sourceId, side = 'source') {
  return f.db.transaction(
    (tx) => scanRecordIsUnchanged(tx, config, 'issues', record, sourceId, side),
    { readOnly: true },
  );
}
test('unchanged imported snapshots avoid source re-fetches without mutating the baseline', async () => {
  const { f, source, actor, config } = await configured();
  try {
    const original = source.data.issues[0],
      nativeId = targetId(actor.workspace_id, source.ids.org, 'issues', original.id);
    const page = {
      id: original.id,
      updatedAt: original.updatedAt,
      archivedAt: original.archivedAt ?? null,
      identifier: original.identifier,
    };
    const before = await f.db.transaction((tx) => tx.all('SELECT * FROM outbox ORDER BY id'));
    expect(await check(f, config, page, original.id)).toBe(true);
    const native = await f.db.transaction((tx) => loadNative(tx, config, 'issues', nativeId));
    expect(await check(f, config, native, original.id, 'native')).toBe(true);
    expect(await f.db.transaction((tx) => tx.all('SELECT * FROM outbox ORDER BY id'))).toEqual(
      before,
    );
    expect(
      await check(f, config, { ...page, updatedAt: '2026-09-27T00:00:00.000Z' }, original.id),
    ).toBe(false);
    expect(await check(f, config, { ...page, updatedAt: 'not-a-timestamp' }, original.id)).toBe(
      false,
    );
    expect(
      await check(
        f,
        config,
        { id: crypto.randomUUID(), updatedAt: page.updatedAt },
        crypto.randomUUID(),
      ),
    ).toBe(false);
    await f.request('PATCH', '/api/v1/issues/' + nativeId, {
      version: 1,
      title: 'Native edit must be queued',
    });
    expect(await check(f, config, page, original.id)).toBe(false);
  } finally {
    await f.close();
  }
});
test('conflicts, creation intents, removals, wrong codes and missing references always stay queued', async () => {
  const { f, source, actor, config } = await configured();
  try {
    const original = source.data.issues[0],
      nativeId = targetId(actor.workspace_id, source.ids.org, 'issues', original.id);
    const page = {
      id: original.id,
      updatedAt: original.updatedAt,
      archivedAt: original.archivedAt ?? null,
      identifier: original.identifier,
    };
    for (const state of [
      { intent: { kind: 'create' } },
      { removedAt: original.updatedAt },
      { conflicts: { title: { local: 'a', source: 'b' } } },
    ]) {
      await f.db.transaction((tx) =>
        writeEntityState(tx, actor.workspace_id, 'issues', original.id, state),
      );
      expect(await check(f, config, page, original.id)).toBe(false);
    }
    await f.db.transaction((tx) =>
      writeEntityState(tx, actor.workspace_id, 'issues', original.id, {}),
    );
    await f.db.transaction((tx) =>
      tx.exec('UPDATE issues SET key=? WHERE workspace_id=? AND id=?', [
        'WRONG-998',
        actor.workspace_id,
        nativeId,
      ]),
    );
    expect(await check(f, config, page, original.id)).toBe(false);
    await f.db.transaction((tx) =>
      tx.exec('UPDATE issues SET key=? WHERE workspace_id=? AND id=?', [
        original.identifier,
        actor.workspace_id,
        nativeId,
      ]),
    );
    await f.db.transaction((tx) =>
      tx.exec(
        "DELETE FROM linear_source_map WHERE workspace_id=? AND collection='workflowStates'",
        [actor.workspace_id],
      ),
    );
    expect(await check(f, config, page, original.id)).toBe(false);
  } finally {
    await f.close();
  }
});
test('a source scan skips unchanged entities but preserves cursor progress and changed records', async () => {
  const { enqueueSyncJob } = await import('../../packages/server/modules/linear-live/store.mjs');
  const { reconcileScanJob } = await import('../../packages/server/modules/linear-live/scans.mjs');
  const { f, source, actor, env, config } = await configured();
  try {
    const unchanged = source.data.issues[0],
      changed = source.data.issues[1];
    const job = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        {
          kind: 'scan',
          side: 'source',
          collection: 'issues',
          pass: '2026-09-27T00:00:00.000Z',
          cursor: null,
        },
        'skip-known',
      ),
    );
    let calls = 0;
    const result = await reconcileScanJob(f.db, env, job.id, config.generation, {
      fetcher: async (_url, options) => {
        calls++;
        return Response.json({
          data: JSON.parse(options.body).query.includes('SyncOrganization')
            ? { organization: { id: source.ids.org } }
            : {
                issues: {
                  nodes: [
                    {
                      id: unchanged.id,
                      updatedAt: unchanged.updatedAt,
                      archivedAt: unchanged.archivedAt ?? null,
                      identifier: unchanged.identifier,
                    },
                    { id: changed.id, updatedAt: '2026-09-27T00:00:00.000Z' },
                  ],
                  pageInfo: { hasNextPage: true, endCursor: 'next-safe-page' },
                },
              },
        });
      },
    });
    expect(result).toMatchObject({ status: 'scanned', queued: 1, unchanged: 1 });
    expect(calls).toBe(2);
    const rows = await f.db.transaction((tx) =>
      tx.all("SELECT event,payload FROM outbox WHERE provider='linear' AND status='pending'"),
    );
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows.find((row) => row.event === 'entity').payload).sourceId).toBe(
      changed.id,
    );
    expect(JSON.parse(rows.find((row) => row.event === 'scan').payload).cursor).toBe(
      'next-safe-page',
    );
  } finally {
    await f.close();
  }
});

test('source archive or derived identifier changes remain discoverable without an updatedAt change', async () => {
  const { f, source, config } = await configured();
  try {
    const original = source.data.issues[0];
    const page = {
      id: original.id,
      updatedAt: original.updatedAt,
      archivedAt: original.archivedAt ?? null,
      identifier: original.identifier,
    };
    expect(
      await check(f, config, { ...page, archivedAt: '2026-09-27T00:00:00.000Z' }, original.id),
    ).toBe(false);
    expect(await check(f, config, { ...page, identifier: 'OTHER-999' }, original.id)).toBe(false);
    expect(await check(f, config, { id: page.id, updatedAt: page.updatedAt }, original.id)).toBe(
      false,
    );
  } finally {
    await f.close();
  }
});
