import { mappedNoticeVerifier } from './migration-notice.mjs';
import { NATIVE_EXPORT_COLLECTIONS } from './engine.mjs';
import { scanRecordIsUnchanged } from './scan-unchanged.mjs';
import { assert } from '../../core/errors.mjs';

import { readSourcePage, verifySourceOrganization, SOURCE_MODELS } from './client.mjs';
import {
  claimSyncJob,
  assertJobFence,
  finishSyncJob,
  failSyncJob,
  enqueueSyncJob,
  writeEntityState,
} from './store.mjs';
import { TABLES } from './model.mjs';
export async function startReconciliation(tx, config, pass = new Date().toISOString()) {
  const jobs = [];
  for (const collection of Object.keys(SOURCE_MODELS))
    jobs.push(
      await enqueueSyncJob(
        tx,
        config.workspaceId,
        { kind: 'scan', collection, side: 'source', pass, cursor: null },
        'scan:' + collection + ':' + pass,
      ),
    );
  for (const collection of NATIVE_EXPORT_COLLECTIONS)
    jobs.push(
      await enqueueSyncJob(
        tx,
        config.workspaceId,
        { kind: 'scan', collection, side: 'native', pass, cursor: null },
        'native-scan:' + collection + ':' + pass,
      ),
    );
  return jobs.map((j) => j.id);
}
export async function reconcileScanJob(db, env, id, generation, options = {}) {
  const job = await claimSyncJob(db, env, id, generation);
  if (!job) return { status: 'not-claimed' };
  const io = { ...options, deadline: options.deadline ?? Date.now() + 45000 };
  io.verifyMigrationNotices = mappedNoticeVerifier(db, job.config, {
    allowSourceTeamMove: job.data.side === 'source',
  });
  try {
    const { collection, side, pass, cursor } = job.data;
    assert(SOURCE_MODELS[collection], 422, 'SYNC_MODEL_UNSUPPORTED', 'Unknown scan family');
    const backlog = await db.transaction(
      (tx) =>
        tx.one(
          "SELECT COUNT(*) AS count FROM outbox WHERE workspace_id=? AND provider='linear' AND status IN ('pending','processing') AND event='entity'",
          [job.workspace_id],
        ),
      { readOnly: true },
    );
    assert(
      Number(backlog.count) < 300,
      429,
      'SYNC_BACKPRESSURE',
      'Drain pending entity work before scanning more source pages',
    );
    let records, next;
    if (side === 'source') {
      await verifySourceOrganization(env, job.config.organizationId, io);
      const page = await readSourcePage(env, collection, { cursor, limit: 40 }, io);
      records = page.nodes;
      next = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } else {
      records = await db.transaction(
        (tx) =>
          tx.all(
            `SELECT * FROM ${TABLES[collection]} WHERE workspace_id=? ${cursor ? 'AND id>?' : ''} ORDER BY id LIMIT 40`,
            [job.workspace_id, ...(cursor ? [cursor] : [])],
          ),
        { readOnly: true },
      );
      next = records.length === 40 ? records.at(-1).id : null;
    }
    return db.transaction(async (tx) => {
      await assertJobFence(tx, job);
      let unchanged = 0,
        queued = 0;
      for (const record of records) {
        let sourceId = record.id;
        if (side === 'native') {
          const mapping = await tx.all(
            'SELECT source_id FROM linear_source_map WHERE workspace_id=? AND source_workspace_id=? AND collection=? AND target_id=?',
            [job.workspace_id, job.config.organizationId, collection, record.id],
          );
          sourceId = mapping.length === 1 ? mapping[0].source_id : record.id;
        }
        if (await scanRecordIsUnchanged(tx, job.config, collection, record, sourceId, side)) {
          unchanged++;
          continue;
        }
        queued++;
        await enqueueSyncJob(
          tx,
          job.workspace_id,
          {
            kind: 'entity',
            collection,
            sourceId,
            side,
            ...(side === 'native' ? { targetId: record.id } : {}),
          },
          'scan-entity:' + pass + ':' + side + ':' + collection + ':' + record.id,
        );
      }
      if (next)
        await enqueueSyncJob(
          tx,
          job.workspace_id,
          { kind: 'scan', collection, side, pass, cursor: next },
          'scan-page:' + pass + ':' + side + ':' + collection + ':' + next,
        );
      else
        await writeEntityState(tx, job.workspace_id, 'scan', side + ':' + collection, {
          collection,
          side,
          lastCompleteAt: new Date().toISOString(),
          pass,
        });
      await finishSyncJob(tx, job, {
        queued,
        unchanged,
        examined: records.length,
        hasNext: Boolean(next),
      });
      return { status: 'scanned', queued, unchanged };
    });
  } catch (error) {
    await failSyncJob(db, job, error);
    return { status: 'failed', code: error.code ?? 'SYNC_TRANSIENT_ERROR' };
  }
}
