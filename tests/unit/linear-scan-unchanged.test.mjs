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

test('a Linear profile photo missing from the import snapshot is pulled once, then the scan settles', async () => {
  const { enqueueSyncJob } = await import('../../packages/server/modules/linear-live/store.mjs');
  const { reconcileScanJob } = await import('../../packages/server/modules/linear-live/scans.mjs');
  const { reconcileEntityJob } =
    await import('../../packages/server/modules/linear-live/engine.mjs');
  const { f, source, actor, env, config } = await configured();
  try {
    // The imported snapshot has no avatarUrl and Linear's updatedAt has not moved since (UB-95).
    const original = source.data.users[0];
    const live = {
      id: original.id,
      createdAt: original.createdAt,
      updatedAt: original.updatedAt,
      archivedAt: null,
      name: original.name,
      displayName: 'source',
      email: original.email,
      avatarUrl: ' https://public.linear.app/avatars/source-author.png\n',
      active: true,
    };
    const pages = [];
    const fetcher = async (_url, options) => {
      const { query } = JSON.parse(options.body);
      if (query.includes('SyncOrganization'))
        return Response.json({ data: { organization: { id: source.ids.org } } });
      if (query.includes('SyncPage')) {
        pages.push(query);
        // The page carries only the fields the scan asks for.
        const fields = ['id', 'updatedAt', 'archivedAt', 'name', 'email', 'avatarUrl'].filter(
          (field) => new RegExp('\\b' + field + '\\b').test(query),
        );
        const node = Object.fromEntries(fields.map((field) => [field, live[field]]));
        return Response.json({
          data: { users: { nodes: [node], pageInfo: { hasNextPage: false, endCursor: null } } },
        });
      }
      if (query.includes('SyncEntity')) return Response.json({ data: { user: live } });
      throw Error('Unexpected provider call');
    };
    const scan = async (pass) => {
      const job = await f.db.transaction((tx) =>
        enqueueSyncJob(
          tx,
          actor.workspace_id,
          { kind: 'scan', side: 'source', collection: 'users', pass, cursor: null },
          'scan-users:' + pass,
        ),
      );
      return reconcileScanJob(f.db, env, job.id, config.generation, { fetcher });
    };
    expect(await scan('2026-10-01T00:00:00.000Z')).toMatchObject({
      status: 'scanned',
      queued: 1,
    });
    const entity = await f.db.transaction((tx) =>
      tx.one(
        "SELECT id FROM outbox WHERE provider='linear' AND event='entity' AND status='pending'",
      ),
    );
    await reconcileEntityJob(f.db, env, entity.id, config.generation, { fetcher });
    const stored = await f.db.transaction((tx) =>
      tx.one(
        'SELECT name,email,avatar_url FROM source_people WHERE workspace_id=? AND source_id=?',
        [actor.workspace_id, original.id],
      ),
    );
    expect(stored).toEqual({
      name: original.name,
      email: original.email,
      avatar_url: 'https://public.linear.app/avatars/source-author.png',
    });
    // Converged: the next pass queues nothing for this profile.
    expect(await scan('2026-10-01T01:00:00.000Z')).toMatchObject({
      status: 'scanned',
      queued: 0,
      unchanged: 1,
    });
    expect(pages).toHaveLength(2);
  } finally {
    await f.close();
  }
});
