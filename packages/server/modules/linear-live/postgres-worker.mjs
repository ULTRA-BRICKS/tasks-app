import { assert } from '../../core/errors.mjs';
import { readSyncConfig, pendingSyncJobs, readEntityState, writeEntityState } from './store.mjs';
import { startReconciliation } from './scans.mjs';
import { processLinearMessage } from './dispatch.mjs';
import { linearQueueDriver } from './runtime.mjs';

// Scheduling changes, not reconciliation: the same durable rows, leases, permission
// checks, retry deadlines and per-field merge remain authoritative on every host.
export async function runPostgresLinearTick(db, env, options = {}) {
  assert(
    linearQueueDriver(env) === 'postgres',
    503,
    'SYNC_RUNTIME_INVALID',
    'PostgreSQL queue mode required',
  );
  const limit = options.limit ?? 5;
  assert(
    Number.isInteger(limit) && limit >= 1 && limit <= 20,
    422,
    'SYNC_WORKER_LIMIT',
    'Worker batch must be from 1 to 20',
  );
  let state;
  try {
    state = await db.transaction(
      async (tx) => {
        const config = await readSyncConfig(tx, env, { optional: true });
        return config
          ? { config, jobs: await pendingSyncJobs(tx, config.workspaceId, limit) }
          : null;
      },
      { readOnly: true },
    );
  } catch (error) {
    if (['SYNC_DEPLOYMENT_CHANGED', 'SYNC_ACTOR_REVOKED'].includes(error.code))
      return { status: 'inactive', processed: 0, retrying: 0 };
    throw error;
  }
  if (!state) return { status: 'inactive', processed: 0, retrying: 0 };
  const result = { status: 'active', processed: 0, retrying: 0 };
  const deadline = options.deadline ?? Date.now() + 45000;
  for (const row of state.jobs) {
    if (Date.now() >= deadline) break;
    try {
      await processLinearMessage(
        db,
        env,
        { jobId: row.id, generation: state.config.generation },
        { ...options, deadline },
      );
      result.processed++;
    } catch (error) {
      if (
        !error.code ||
        ![
          'SYNC_RETRY',
          'SOURCE_RATE_LIMITED',
          'SOURCE_NETWORK_ERROR',
          'SYNC_TRANSIENT_ERROR',
        ].includes(error.code)
      )
        throw error;
      result.retrying++;
    }
  }
  return result;
}

// The daily receipt and scan jobs commit together under the same workspace lock
// used by writer configuration. Restarts and concurrent pollers cannot duplicate a day.
export async function scheduleDailyReconciliation(db, env, timestamp = Date.now()) {
  assert(
    linearQueueDriver(env) === 'postgres',
    503,
    'SYNC_RUNTIME_INVALID',
    'PostgreSQL queue mode required',
  );
  assert(
    Number.isSafeInteger(timestamp) && timestamp >= 0 && timestamp < 8640000000000000,
    422,
    'SYNC_CLOCK_INVALID',
    'Valid scheduler time required',
  );
  if (!env.LINEAR_SYNC_WORKSPACE_ID) return { status: 'inactive', scheduled: 0 };
  const day = new Date(timestamp).toISOString().slice(0, 10);
  try {
    return await db.transaction(async (tx) => {
      await tx.lock(env.LINEAR_SYNC_WORKSPACE_ID);
      const config = await readSyncConfig(tx, env, { optional: true });
      if (!config) return { status: 'inactive', scheduled: 0 };
      const previous = await readEntityState(
        tx,
        config.workspaceId,
        'daily-reconciliation',
        config.organizationId,
      );
      if (previous?.day >= day) return { status: 'already-scheduled', scheduled: 0 };
      const jobs = await startReconciliation(tx, config, day + 'T00:00:00.000Z');
      await writeEntityState(
        tx,
        config.workspaceId,
        'daily-reconciliation',
        config.organizationId,
        {
          collection: 'daily-reconciliation',
          sourceId: config.organizationId,
          day,
          generation: config.generation,
          scheduledAt: new Date(timestamp).toISOString(),
          jobs,
        },
      );
      return { status: 'scheduled', scheduled: jobs.length };
    });
  } catch (error) {
    if (['SYNC_DEPLOYMENT_CHANGED', 'SYNC_ACTOR_REVOKED'].includes(error.code))
      return { status: 'inactive', scheduled: 0 };
    throw error;
  }
}
