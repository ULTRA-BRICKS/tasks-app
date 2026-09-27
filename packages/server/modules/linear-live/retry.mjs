import { assert, requirePermission } from '../../core/errors.mjs';
import { id, now } from '../../core/crypto.mjs';
import { canonical } from '../../../imports/linear-source.mjs';
import { readSyncConfig } from './store.mjs';
export async function retrySyncJobs(tx, actor, env, input) {
  requirePermission(actor, 'admin');
  const config = await readSyncConfig(tx, env);
  assert(config.workspaceId === actor.workspace_id, 403, 'SYNC_WORKSPACE', 'Workspace mismatch');
  await tx.lock(actor.workspace_id);
  const retried = [];
  for (const jobId of input.jobIds) {
    const row = await tx.one(
      "SELECT * FROM outbox WHERE workspace_id=? AND id=? AND provider='linear' AND status IN ('failed','blocked')",
      [actor.workspace_id, jobId],
    );
    if (!row) continue;
    const payload = JSON.parse(row.payload);
    // Retain signed-delivery proof and cursor; only reset an explicitly selected terminal job.
    delete payload._lease;
    delete payload._entityKey;
    delete payload._dirty;
    delete payload._nextDispatchToken;
    delete payload._generation;
    delete payload._capacityPauses;
    payload._dispatchToken = id();
    payload._previousError = row.last_error;
    payload._retriedAt = now();
    payload._retryCount = (payload._retryCount ?? 0) + 1;
    const changed = await tx.exec(
      "UPDATE outbox SET status='pending',attempts=0,last_error=NULL,payload=?,next_attempt_at=? WHERE workspace_id=? AND id=? AND status=? AND attempts=?",
      [canonical(payload), now(), actor.workspace_id, jobId, row.status, row.attempts],
    );
    assert(Number(changed.changes) === 1, 409, 'SYNC_RETRY_RACE', 'Job changed during retry');
    retried.push(jobId);
  }
  return { retried };
}
