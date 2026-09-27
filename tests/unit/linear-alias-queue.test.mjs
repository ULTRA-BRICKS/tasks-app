import { test, expect } from 'bun:test';
import { configured } from './linear-live-queue.test.mjs';
import { queueNativeLinearChange } from '../../packages/server/core/linear-events.mjs';
import { enqueueSyncJob, claimSyncJob } from '../../packages/server/modules/linear-live/store.mjs';
import { reconcileScanJob } from '../../packages/server/modules/linear-live/scans.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';
for (const mode of ['event', 'scan'])
  test('ambiguous native ' + mode + ' never preselects an arbitrary source alias', async () => {
    const { f, actor, source, env, config } = await configured();
    try {
      const native = targetId(actor.workspace_id, source.ids.org, 'issues', source.ids.issue);
      await f.db.transaction(async (tx) => {
        const m = await tx.one(
          'SELECT * FROM linear_source_map WHERE workspace_id=? AND collection=? AND source_id=?',
          [actor.workspace_id, 'issues', source.ids.issue],
        );
        await tx.exec(
          'INSERT INTO linear_source_map(workspace_id,source_workspace_id,collection,source_id,target_id,payload_hash,import_id) VALUES(?,?,?,?,?,?,?)',
          [
            m.workspace_id,
            m.source_workspace_id,
            m.collection,
            crypto.randomUUID(),
            m.target_id,
            m.payload_hash,
            m.import_id,
          ],
        );
        await tx.exec('UPDATE issues SET title=? WHERE workspace_id=? AND id=?', [
          'Native ambiguous edit',
          actor.workspace_id,
          native,
        ]);
        if (mode === 'event') await queueNativeLinearChange(tx, actor, 'issues', native, 2);
      });
      if (mode === 'scan') {
        const scan = await f.db.transaction((tx) =>
          enqueueSyncJob(
            tx,
            actor.workspace_id,
            {
              kind: 'scan',
              collection: 'issues',
              side: 'native',
              pass: '2026-09-27T10:00:00Z',
              cursor: null,
            },
            'alias-scan',
          ),
        );
        expect((await reconcileScanJob(f.db, env, scan.id, config.generation)).status).toBe(
          'scanned',
        );
      }
      const job = await f.db.transaction((tx) =>
        tx.one(
          "SELECT * FROM outbox WHERE workspace_id=? AND provider='linear' AND event='entity' AND payload LIKE ?",
          [actor.workspace_id, '%"targetId":"' + native + '"%'],
        ),
      );
      expect(JSON.parse(job.payload).sourceId).toBe(native);
      expect(await claimSyncJob(f.db, env, job.id, config.generation)).toBeNull();
      const blocked = await f.db.transaction((tx) =>
        tx.one('SELECT status,last_error FROM outbox WHERE id=?', [job.id]),
      );
      expect(blocked).toEqual({ status: 'blocked', last_error: 'SYNC_SOURCE_ALIAS_AMBIGUOUS' });
    } finally {
      await f.close();
    }
  });
