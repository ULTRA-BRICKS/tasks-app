import { pendingSyncJobs, readSyncConfig } from './store.mjs';
// Queue messages contain only job UUIDs. Private data and retry state remain in the authorized database.
export async function dispatchLinearJobs(db, env, { send, limit = 20 } = {}) {
  if (!env.LINEAR_SYNC_WORKSPACE_ID) return { sent: 0 };
  const state = await db.transaction(
    async (tx) => {
      const config = await readSyncConfig(tx, env, { optional: true });
      return config ? { config, jobs: await pendingSyncJobs(tx, config.workspaceId, limit) } : null;
    },
    { readOnly: true },
  );
  if (!state) return { sent: 0 };
  const publish = send ?? (await import('@vercel/queue')).send;
  await Promise.all(
    state.jobs.map((job) =>
      publish(
        'tasks-linear-sync',
        { jobId: job.id, generation: state.config.generation },
        {
          region: 'fra1',
          idempotencyKey:
            state.config.generation + ':' + job.id + ':' + Math.floor(Date.now() / 60000),
          retentionSeconds: 86400,
        },
      ),
    ),
  );
  return { sent: state.jobs.length };
}
export async function processLinearMessage(db, env, message, options = {}) {
  const { reconcileEntityJob } = await import('./engine.mjs');
  const { reconcileScanJob } = await import('./scans.mjs');
  const row = await db.transaction(
    (tx) =>
      tx.one(
        "SELECT event,status FROM outbox WHERE workspace_id=? AND id=? AND provider='linear'",
        [env.LINEAR_SYNC_WORKSPACE_ID, message.jobId],
      ),
    { readOnly: true },
  );
  if (!row || ['done', 'failed', 'blocked'].includes(row.status))
    return { status: row?.status ?? 'missing' };
  const result = await (row.event === 'scan' ? reconcileScanJob : reconcileEntityJob)(
    db,
    env,
    message.jobId,
    message.generation,
    options,
  );
  await dispatchLinearJobs(db, env, options);
  if (result.status === 'failed' || result.status === 'not-claimed') {
    const current = await db.transaction(
      (tx) =>
        tx.one('SELECT status FROM outbox WHERE workspace_id=? AND id=?', [
          env.LINEAR_SYNC_WORKSPACE_ID,
          message.jobId,
        ]),
      { readOnly: true },
    );
    if (current && ['pending', 'processing'].includes(current.status))
      throw Object.assign(Error('Sync retry scheduled'), { code: result.code ?? 'SYNC_RETRY' });
  }
  return result;
}
