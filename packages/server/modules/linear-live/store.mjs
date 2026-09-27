import { assert, AppError, requirePermission } from '../../core/errors.mjs';
import { id, now } from '../../core/crypto.mjs';
import { canonical, targetId, uuid } from '../../../imports/linear-source.mjs';
const key = (workspace, kind, value) => targetId(workspace, 'linear-managed-v1', kind, value);
export async function configureSync(tx, actor, input, env) {
  requirePermission(actor, 'admin');
  assert(
    actor.workspace_id === env.LINEAR_SYNC_WORKSPACE_ID,
    403,
    'SYNC_WORKSPACE',
    'Workspace is not configured for Linear',
  );
  assert(
    uuid(input.organizationId),
    422,
    'INVALID_ORGANIZATION',
    'Source organization must be a UUID',
  );
  const imported = await tx.one(
    "SELECT id FROM linear_imports WHERE workspace_id=? AND source_workspace_id=? AND status='completed' LIMIT 1",
    [actor.workspace_id, input.organizationId],
  );
  assert(imported, 403, 'SYNC_ORGANIZATION', 'Source organization has not been imported');
  assert(
    env.LINEAR_API_TOKEN && env.LINEAR_WEBHOOK_SECRET,
    503,
    'SYNC_NOT_CONFIGURED',
    'Server synchronization credentials are missing',
  );
  await tx.lock(actor.workspace_id);
  const knownTeams = await tx.all(
    "SELECT source_id FROM linear_source_map WHERE workspace_id=? AND source_workspace_id=? AND collection='teams'",
    [actor.workspace_id, input.organizationId],
  );
  const config = {
    workspaceId: actor.workspace_id,
    organizationId: input.organizationId,
    userId: actor.id,
    enabled: input.enabled === true,
    generation: id(),
    deploymentId: env.VERCEL_DEPLOYMENT_ID ?? null,
    teamIds: input.teamIds?.length ? input.teamIds : knownTeams.map((t) => t.source_id),
    configuredAt: now(),
  };
  assert(
    config.teamIds.length <= 100 && config.teamIds.every(uuid),
    422,
    'INVALID_SYNC_TEAMS',
    'Invalid team scope',
  );
  await tx.exec(
    "INSERT INTO module_settings(workspace_id,module,enabled,config) VALUES(?,'linear',?,?) ON CONFLICT(workspace_id,module) DO UPDATE SET enabled=excluded.enabled,config=excluded.config",
    [actor.workspace_id, config.enabled ? 1 : 0, canonical(config)],
  );
  return config;
}
export async function readSyncConfig(tx, env, { optional = false } = {}) {
  const workspace = env.LINEAR_SYNC_WORKSPACE_ID;
  if (!workspace) {
    if (optional) return null;
    assert(false, 503, 'SYNC_NOT_CONFIGURED', 'Workspace is not configured');
  }
  const row = await tx.one(
    "SELECT config AS payload FROM module_settings WHERE workspace_id=? AND module='linear'",
    [workspace],
  );
  if (!row) {
    if (optional) return null;
    assert(false, 503, 'SYNC_NOT_CONFIGURED', 'Synchronization has not been enabled');
  }
  const config = JSON.parse(row.payload);
  if (!config.enabled) {
    if (optional) return null;
    assert(false, 503, 'SYNC_DISABLED', 'Synchronization is paused');
  }
  assert(
    !config.deploymentId || config.deploymentId === env.VERCEL_DEPLOYMENT_ID,
    409,
    'SYNC_DEPLOYMENT_CHANGED',
    'This deployment is not the active synchronization writer',
  );
  const user = await tx.one(
    'SELECT u.id,u.name,u.email,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.workspace_id=? AND u.id=?',
    [workspace, config.userId],
  );
  assert(
    user && ['owner', 'admin'].includes(user.role),
    403,
    'SYNC_ACTOR_REVOKED',
    'The configuring administrator no longer has permission',
  );
  return {
    ...config,
    actor: {
      ...user,
      workspace_id: workspace,
      scopes: ['read', 'write', 'admin'],
      syncOrigin: 'linear',
    },
  };
}
export async function enqueueSyncJob(tx, workspace, data, deduplicationKey) {
  assert(
    uuid(workspace) && typeof deduplicationKey === 'string' && deduplicationKey.length <= 500,
    422,
    'INVALID_SYNC_JOB',
    'Invalid queue identity',
  );
  const jobId = key(workspace, 'job', deduplicationKey),
    stamp = now();
  await tx.exec(
    "INSERT INTO outbox(id,workspace_id,provider,event,payload,status,attempts,next_attempt_at,created_at) VALUES(?,?,'linear',?,?,'pending',0,?,?) ON CONFLICT(id) DO NOTHING",
    [jobId, workspace, data.kind, canonical(data), stamp, stamp],
  );
  return tx.one("SELECT * FROM outbox WHERE id=? AND workspace_id=? AND provider='linear'", [
    jobId,
    workspace,
  ]);
}
export async function enqueueNativeSyncJob(tx, workspace, data) {
  data = { ...data, _dispatchToken: id() };
  const jobId = key(workspace, 'job', 'native:' + data.collection + ':' + data.targetId),
    stamp = now();
  const made = await tx.exec(
    "INSERT INTO outbox(id,workspace_id,provider,event,payload,status,attempts,next_attempt_at,created_at) VALUES(?,?,'linear','entity',?,'pending',0,?,?) ON CONFLICT(id) DO NOTHING",
    [jobId, workspace, canonical(data), stamp, stamp],
  );
  if (Number(made.changes) === 1) return { id: jobId };
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await tx.one(
      "SELECT status,payload,attempts FROM outbox WHERE id=? AND workspace_id=? AND provider='linear'",
      [jobId, workspace],
    );
    assert(row, 409, 'SYNC_QUEUE_CHANGED', 'Native queue changed concurrently');
    const processing = row.status === 'processing';
    const payload = processing
      ? { ...JSON.parse(row.payload), _dirty: true, _nextDispatchToken: data._dispatchToken }
      : data;
    const changed = await tx.exec(
      "UPDATE outbox SET payload=?,status=?,attempts=?,last_error=NULL,next_attempt_at=CASE WHEN status='processing' THEN next_attempt_at ELSE ? END WHERE id=? AND workspace_id=? AND status=? AND attempts=? AND payload=?",
      [
        canonical(payload),
        processing ? 'processing' : 'pending',
        processing ? row.attempts : 0,
        stamp,
        jobId,
        workspace,
        row.status,
        row.attempts,
        row.payload,
      ],
    );
    if (Number(changed.changes) === 1) return { id: jobId };
  }
  assert(false, 409, 'SYNC_QUEUE_CHANGED', 'Native queue changed during enqueue');
}
export async function claimSyncJob(db, env, jobId, generation) {
  return db.transaction(async (tx) => {
    await tx.lock(env.LINEAR_SYNC_WORKSPACE_ID);
    const config = await readSyncConfig(tx, env);
    if (config.generation !== generation) return null;
    const row = await tx.one(
      "SELECT * FROM outbox WHERE id=? AND workspace_id=? AND provider='linear' AND status IN ('pending','processing') AND next_attempt_at<=?",
      [jobId, config.workspaceId, now()],
    );
    if (!row) return null;
    const data = JSON.parse(row.payload),
      lease = id(),
      attempts = row.attempts + 1;
    const entityKey =
      data.kind === 'entity'
        ? key(config.workspaceId, 'entity-lease', data.collection + ':' + data.sourceId)
        : null;
    if (entityKey) {
      const active = await tx.one(
        "SELECT payload,next_attempt_at FROM outbox WHERE id=? AND workspace_id=? AND status='lease'",
        [entityKey, config.workspaceId],
      );
      const owner = active ? JSON.parse(active.payload) : null;
      if (
        owner &&
        owner.generation === generation &&
        owner.jobId !== jobId &&
        Date.parse(active.next_attempt_at) > Date.now()
      )
        return null;
      const stamp = now();
      await tx.exec(
        "INSERT INTO outbox(id,workspace_id,provider,event,payload,status,attempts,next_attempt_at,created_at) VALUES(?,?,'linear','entity-lease',?,'lease',0,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,next_attempt_at=excluded.next_attempt_at",
        [
          entityKey,
          config.workspaceId,
          canonical({ jobId, lease, generation }),
          new Date(Date.now() + 65000).toISOString(),
          stamp,
        ],
      );
    }
    const leased = { ...data, _lease: lease, _generation: generation, _entityKey: entityKey };
    await tx.exec(
      "UPDATE outbox SET status='processing',attempts=?,payload=?,next_attempt_at=? WHERE id=? AND workspace_id=?",
      [
        attempts,
        canonical(leased),
        new Date(Date.now() + 65000).toISOString(),
        jobId,
        config.workspaceId,
      ],
    );
    return { ...row, payload: canonical(leased), data: leased, attempts, config };
  });
}
export async function assertJobFence(tx, job) {
  await tx.lock(job.workspace_id);
  const live = await tx.one(
    "SELECT status,attempts,payload FROM outbox WHERE id=? AND workspace_id=? AND provider='linear'",
    [job.id, job.workspace_id],
  );
  const actual = live ? JSON.parse(live.payload) : null,
    expected = job.data ?? JSON.parse(job.payload);
  assert(
    live?.status === 'processing' &&
      live.attempts === job.attempts &&
      actual?._lease === expected._lease,
    409,
    'SYNC_LEASE_LOST',
    'Another worker has superseded this claim',
  );
  if (expected._entityKey) {
    const entity = await tx.one(
      "SELECT payload FROM outbox WHERE id=? AND workspace_id=? AND status='lease'",
      [expected._entityKey, job.workspace_id],
    );
    assert(
      entity && JSON.parse(entity.payload).lease === expected._lease,
      409,
      'SYNC_ENTITY_LEASE_LOST',
      'Another delivery now owns this entity',
    );
  }
  const row = await tx.one(
    "SELECT config AS payload FROM module_settings WHERE workspace_id=? AND module='linear'",
    [job.workspace_id],
  );
  const config = row ? JSON.parse(row.payload) : null;
  assert(
    config?.enabled && config.generation === expected._generation,
    409,
    'SYNC_CONFIGURATION_CHANGED',
    'Synchronization configuration changed',
  );
  const permission = await tx.one(
    'SELECT role FROM memberships WHERE workspace_id=? AND user_id=?',
    [job.workspace_id, config.userId],
  );
  assert(
    permission && ['owner', 'admin'].includes(permission.role),
    403,
    'SYNC_ACTOR_REVOKED',
    'The configuring administrator no longer has permission',
  );
}
export async function finishSyncJob(tx, job, result) {
  await assertJobFence(tx, job);
  const live = await tx.one(
    'SELECT payload FROM outbox WHERE id=? AND workspace_id=?' +
      (tx.dialect === 'postgres' ? ' FOR UPDATE' : ''),
    [job.id, job.workspace_id],
  );
  const currentPayload = JSON.parse(live.payload);
  const dirty = currentPayload._dirty === true;
  const payload = { ...job.data, result };
  delete payload._lease;
  delete payload._dirty;
  if (dirty) payload._dispatchToken = currentPayload._nextDispatchToken ?? id();
  delete payload._nextDispatchToken;

  if (job.data._entityKey)
    await tx.exec(
      'UPDATE outbox SET next_attempt_at=? WHERE id=? AND workspace_id=? AND payload=?',
      [
        now(),
        job.data._entityKey,
        job.workspace_id,
        canonical({ jobId: job.id, lease: job.data._lease, generation: job.data._generation }),
      ],
    );
  const changed = await tx.exec(
    "UPDATE outbox SET status=?,last_error=NULL,payload=?,attempts=?,next_attempt_at=? WHERE id=? AND workspace_id=? AND status='processing' AND attempts=?",
    [
      dirty ? 'pending' : 'done',
      canonical(payload),
      dirty ? 0 : job.attempts,
      now(),
      job.id,
      job.workspace_id,
      job.attempts,
    ],
  );
  assert(
    Number(changed.changes) === 1,
    409,
    'SYNC_LEASE_LOST',
    'Queue acknowledgement was superseded',
  );
}
export async function failSyncJob(db, job, error) {
  return db.transaction(async (tx) => {
    await tx.lock(job.workspace_id);
    const live = await tx.one(
      "SELECT status,attempts,payload FROM outbox WHERE id=? AND workspace_id=? AND provider='linear'",
      [job.id, job.workspace_id],
    );
    if (
      live?.status !== 'processing' ||
      live.attempts !== job.attempts ||
      JSON.parse(live.payload)._lease !== job.data._lease
    )
      return false;
    const livePayload = JSON.parse(live.payload),
      dirty = livePayload._dirty === true;
    const nextPayload = { ...livePayload };
    delete nextPayload._dirty;
    delete nextPayload._nextDispatchToken;
    delete nextPayload._lease;
    if (dirty) nextPayload._dispatchToken = livePayload._nextDispatchToken ?? id();
    const permanent =
      error instanceof AppError && [400, 401, 403, 404, 413, 422].includes(error.status);
    const code =
      typeof error.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code)
        ? error.code
        : 'SYNC_TRANSIENT_ERROR';
    const delay = Math.max(
      15,
      Math.min(3600, Number(error.retryAfterSeconds) || 2 ** Math.min(job.attempts, 8) * 15),
    );
    await tx.exec(
      "UPDATE outbox SET status=?,last_error=?,next_attempt_at=?,payload=?,attempts=? WHERE id=? AND workspace_id=? AND status='processing' AND attempts=?",
      [
        dirty ? 'pending' : permanent ? 'blocked' : job.attempts >= 8 ? 'failed' : 'pending',
        code,
        dirty ? now() : new Date(Date.now() + delay * 1000).toISOString(),
        canonical(nextPayload),
        dirty ? 0 : job.attempts,
        job.id,
        job.workspace_id,
        job.attempts,
      ],
    );
    if (job.data._entityKey)
      await tx.exec(
        'UPDATE outbox SET next_attempt_at=? WHERE id=? AND workspace_id=? AND payload=?',
        [
          now(),
          job.data._entityKey,
          job.workspace_id,
          canonical({ jobId: job.id, lease: job.data._lease, generation: job.data._generation }),
        ],
      );
    return true;
  });
}
export async function readEntityState(tx, workspace, collection, sourceId) {
  const row = await tx.one(
    "SELECT payload FROM outbox WHERE id=? AND workspace_id=? AND provider='linear' AND status='state'",
    [key(workspace, 'entity-state', collection + ':' + sourceId), workspace],
  );
  return row ? JSON.parse(row.payload) : null;
}
export async function writeEntityState(tx, workspace, collection, sourceId, value) {
  const stamp = now();
  await tx.exec(
    "INSERT INTO outbox(id,workspace_id,provider,event,payload,status,attempts,next_attempt_at,created_at) VALUES(?,?,'linear','entity-state',?,'state',0,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
    [
      key(workspace, 'entity-state', collection + ':' + sourceId),
      workspace,
      canonical(value),
      stamp,
      stamp,
    ],
  );
}
export async function readSyncStatus(tx, actor, env) {
  requirePermission(actor, 'admin');
  assert(
    actor.workspace_id === env.LINEAR_SYNC_WORKSPACE_ID,
    403,
    'SYNC_WORKSPACE',
    'Workspace mismatch',
  );
  const raw = await tx.one(
    "SELECT config AS payload FROM module_settings WHERE workspace_id=? AND module='linear'",
    [actor.workspace_id],
  );
  const config = raw ? JSON.parse(raw.payload) : null;
  const counts = await tx.all(
    "SELECT status,COUNT(*) AS count FROM outbox WHERE workspace_id=? AND provider='linear' AND status NOT IN ('state','lease') GROUP BY status",
    [actor.workspace_id],
  );
  const problems = await tx.all(
    "SELECT id,event,status,last_error,created_at FROM outbox WHERE workspace_id=? AND provider='linear' AND status IN ('blocked','failed') ORDER BY created_at DESC LIMIT 100",
    [actor.workspace_id],
  );
  const conflicts = await tx.all(
    "SELECT id,payload FROM outbox WHERE workspace_id=? AND provider='linear' AND event='entity-state' AND status='state' AND payload LIKE '%\"conflicts\":{%' LIMIT 5000",
    [actor.workspace_id],
  );
  return {
    configuration: config ? { ...config, userId: undefined } : null,
    counts: Object.fromEntries(counts.map((r) => [r.status, Number(r.count)])),
    problems,
    conflicts: conflicts
      .map((r) => JSON.parse(r.payload))
      .filter((r) => Object.keys(r.conflicts ?? {}).length)
      .map((r) => ({
        collection: r.collection,
        sourceId: r.sourceId,
        targetId: r.targetId,
        fields: Object.keys(r.conflicts),
        sourceCode: r.sourceCode,
        nativeCode: r.nativeCode,
      })),
    receiverConfigured: Boolean(env.LINEAR_WEBHOOK_SECRET && env.LINEAR_API_TOKEN),
  };
}
export async function pendingSyncJobs(tx, workspace, limit = 30) {
  return tx.all(
    "SELECT id,payload,status,attempts,next_attempt_at FROM outbox WHERE workspace_id=? AND provider='linear' AND status IN ('pending','processing') AND next_attempt_at<=? ORDER BY created_at,id LIMIT ?",
    [workspace, now(), limit],
  );
}
