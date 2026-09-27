import { test, expect } from 'bun:test';
import { configured } from './linear-live-queue.test.mjs';
import { enqueueSyncJob } from '../../packages/server/modules/linear-live/store.mjs';
import { reconcileEntityJob } from '../../packages/server/modules/linear-live/engine.mjs';

test('a webhook arriving after successful create but failed readback recovers the original native record', async () => {
  const { f, source, actor, env, config } = await configured();
  try {
    const native = (
      await f.request('POST', '/api/v1/documents', {
        title: 'Keep identity',
        body: 'Original content',
      })
    ).data;
    let record = null,
      creates = 0,
      failReadback = true;
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
          createdAt: '2026-09-27T00:00:00Z',
          updatedAt: '2026-09-27T00:00:00Z',
          archivedAt: null,
          project: null,
          initiative: null,
          creator: { id: source.ids.user },
        };
        return Response.json({ data: { documentCreate: { success: true, document: record } } });
      }
      if (query.includes('SyncEntity')) {
        if (failReadback) {
          failReadback = false;
          throw Error('Synthetic missing response');
        }
        return Response.json({ data: { document: record } });
      }
      throw Error('Unexpected provider call');
    };
    const nativeJob = await f.db.transaction((tx) =>
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
        'native-first',
      ),
    );
    expect(
      (await reconcileEntityJob(f.db, env, nativeJob.id, config.generation, { fetcher })).status,
    ).toBe('failed');
    const webhook = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        { kind: 'entity', side: 'source', collection: 'documents', sourceId: native.id },
        'real-webhook-after-create',
      ),
    );
    const result = await reconcileEntityJob(f.db, env, webhook.id, config.generation, { fetcher });
    expect(['exported', 'synced']).toContain(result.status);
    const mapping = await f.db.transaction((tx) =>
      tx.one(
        'SELECT target_id FROM linear_source_map WHERE workspace_id=? AND collection=? AND source_id=?',
        [actor.workspace_id, 'documents', native.id],
      ),
    );
    expect(mapping.target_id).toBe(native.id);
    expect(creates).toBe(1);
    const copies = await f.db.transaction((tx) =>
      tx.all('SELECT id FROM documents WHERE workspace_id=? AND title=?', [
        actor.workspace_id,
        'Keep identity',
      ]),
    );
    expect(copies).toEqual([{ id: native.id }]);
  } finally {
    await f.close();
  }
});
