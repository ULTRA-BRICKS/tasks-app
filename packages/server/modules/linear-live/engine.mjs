import { sourceInScope, nativeInScope } from './scope.mjs';
import { exportNativeIssue, exportNativeComment } from './export.mjs';
import { assert } from '../../core/errors.mjs';
import { canonical, digest, uuid } from '../../../imports/linear-source.mjs';
import { markdownEquivalent } from '../linear-import/source-contract.mjs';
import { requestLinear, readSourceEntity, verifySourceOrganization, SOURCE_MODELS, SourceError } from './client.mjs';
import { claimSyncJob, assertJobFence, finishSyncJob, failSyncJob, readEntityState, writeEntityState } from './store.mjs';
import { contextFor, sourceMapping, loadNative, normalizedNative, referenceResolver } from './context.mjs';
import { sourceReferences, normalizedSource } from './model.mjs';
import { applyNativePatch, createNativeSource, assignLinearCode } from './domain.mjs';
const same = (field, a, b) =>
  a === b ||
  (['description', 'body'].includes(field) && typeof a === 'string' && typeof b === 'string'
    ? markdownEquivalent(a, b)
    : canonical(a ?? null) === canonical(b ?? null));
const ISSUE_REFS = {
  team_id: ['teamId', 'teams'],
  status_id: ['stateId', 'workflowStates'],
  assignee_id: ['assigneeId', 'users'],
  project_id: ['projectId', 'projects'],
  cycle_id: ['cycleId', 'cycles'],
  milestone_id: ['projectMilestoneId', 'projectMilestones'],
  parent_id: ['parentId', 'issues'],
};
function sourcePatch(collection, patch, resolver) {
  const output = {};
  const simple =
    collection === 'issues'
      ? {
          title: 'title',
          description: 'description',
          priority: 'priority',
          estimate: 'estimate',
          due_date: 'dueDate',
        }
      : collection === 'comments'
        ? { body: 'body' }
        : collection === 'projects'
          ? {
              name: 'name',
              description: 'content',
              health: 'health',
              start_date: 'startDate',
              target_date: 'targetDate',
            }
          : collection === 'documents'
            ? { title: 'title', body: 'content' }
            : collection === 'initiatives'
              ? {
                  name: 'name',
                  description: 'content',
                  target_date: 'targetDate',
                  status: 'status',
                }
              : collection === 'issueLabels'
                ? { name: 'name', color: 'color' }
                : collection === 'teams'
                  ? { name: 'name' }
                  : collection === 'workflowStates'
                    ? { name: 'name', color: 'color', position: 'position' }
                    : collection === 'projectMilestones'
                      ? { name: 'name', target_date: 'targetDate', position: 'sortOrder' }
                      : collection === 'cycles'
                        ? { name: 'name', start_date: 'startsAt', end_date: 'endsAt' }
                        : {};
  for (const [field, value] of Object.entries(patch)) {
    if (simple[field]) output[simple[field]] = value;
    else if (collection === 'issues' && ISSUE_REFS[field]) {
      const [name, kind] = ISSUE_REFS[field];
      output[name] = resolver.reverse(kind, value);
    } else if (collection === 'issues' && field === 'label_ids')
      output.labelIds = value.map((id) => resolver.reverse('issueLabels', id));
    else
      assert(
        false,
        409,
        'SYNC_OUTBOUND_FIELD_UNSUPPORTED',
        'This field requires explicit synchronization support',
        { collection, field },
      );
  }
  return output;
}
async function mutateSource(env, collection, sourceId, input, options) {
  const definition = SOURCE_MODELS[collection],
    operation = definition.one + 'Update',
    type = definition.one[0].toUpperCase() + definition.one.slice(1) + 'UpdateInput';
  const result = await requestLinear(
    env,
    `mutation SyncMutation($id:String!,$input:${type}!){${operation}(id:$id,input:$input){success ${definition.one}{${definition.fields}}}}`,
    { id: sourceId, input },
    options,
  );
  const outcome = result[operation];
  assert(
    outcome?.success && outcome[definition.one]?.id === sourceId,
    502,
    'SOURCE_WRITE_UNCONFIRMED',
    'Source update was not confirmed',
  );
  return outcome[definition.one];
}
async function ensureDependencies(db, env, job, record, options, seen = new Set(), depth = 0) {
  assert(
    depth < 20 && seen.size < 100,
    409,
    'SYNC_DEPENDENCY_BUDGET',
    'Dependency graph needs another bounded pass',
  );
  const refs = sourceReferences(job.data.collection, record);
  for (const ref of refs) {
    assert(uuid(ref.id), 422, 'SOURCE_REFERENCE_INVALID', 'Source reference is not a UUID');
    const key = ref.collection + ':' + ref.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const known = await db.transaction(
      (tx) => sourceMapping(tx, job.config, ref.collection, ref.id),
      { readOnly: true },
    );
    if (known) continue;
    const child = await readSourceEntity(env, ref.collection, ref.id, options);
    assert(child, 409, 'SYNC_REFERENCE_MISSING', 'Source dependency is unavailable');
    const childJob = { ...job, data: { ...job.data, collection: ref.collection } };
    await ensureDependencies(db, env, childJob, child, options, seen, depth + 1);
    await db.transaction(async (tx) => {
      await assertJobFence(tx, job);
      if (await sourceMapping(tx, job.config, ref.collection, ref.id)) return;
      const context = await contextFor(tx, job.config, ref.collection, child);
      await createNativeSource(tx, job.config, ref.collection, child, context.source);
    });
  }
}
async function markRemoval(db, env, job, options) {
  const { collection, sourceId, occurredAt, deliveryId } = job.data;
  // Only a verified persisted delivery, never an empty source lookup, authorizes a removal marker.
  assert(
    deliveryId && Number.isFinite(Date.parse(occurredAt)),
    422,
    'SYNC_REMOVAL_PROOF_REQUIRED',
    'A signed source delivery and occurrence time are required',
  );
  await verifySourceOrganization(env, job.config.organizationId, options);
  return db.transaction(async (tx) => {
    await assertJobFence(tx, job);
    const proof = await tx.one(
      "SELECT payload FROM webhook_deliveries WHERE workspace_id=? AND provider='linear' AND delivery_id=?",
      [job.workspace_id, deliveryId],
    );
    const event = proof ? JSON.parse(proof.payload).event : null;
    assert(
      event?.action === 'remove' &&
        event.data?.id === sourceId &&
        event.organizationId === job.config.organizationId,
      403,
      'SYNC_REMOVAL_PROOF_REQUIRED',
      'Stored signed event does not prove this removal',
    );
    const mapping = await sourceMapping(tx, job.config, collection, sourceId),
      state = await readEntityState(tx, job.workspace_id, collection, sourceId);
    const baseTime =
      state?.sourceUpdatedAt ?? (mapping ? JSON.parse(mapping.original).updatedAt : null);
    const lastTime = Math.max(
      Date.parse(baseTime ?? '') || 0,
      Date.parse(state?.removedAt ?? '') || 0,
    );
    if (Date.parse(occurredAt) <= lastTime) {
      await finishSyncJob(tx, job, { ignored: 'older-lifecycle-event' });
      return { status: 'stale' };
    }
    const native = mapping ? await loadNative(tx, job.config, collection, mapping.target_id) : null;
    let conflicts = { ...state?.conflicts };
    if (native) {
      const original = JSON.parse(mapping.original),
        resolver = await referenceResolver(tx, job.config, collection, original, original, native);
      const baseline =
          state?.baseNative ?? normalizedSource(collection, original, resolver.resolve),
        local = normalizedNative(collection, native, Object.keys(baseline));
      if (Object.keys(baseline).some((k) => !same(k, baseline[k], local[k])))
        conflicts.removal = {
          local,
          source: { removedAt: occurredAt },
          reason: 'local-content-changed',
        };
    }
    await writeEntityState(tx, job.workspace_id, collection, sourceId, {
      ...state,
      collection,
      sourceId,
      targetId: mapping?.target_id ?? null,
      removedAt: occurredAt,
      removalProof: deliveryId,
      sourceUpdatedAt: occurredAt,
      conflicts,
    });
    await finishSyncJob(tx, job, {
      sourceRemoved: true,
      retainedLocally: Boolean(native),
      conflict: Boolean(conflicts.removal),
    });
    return { status: 'removed', retained: Boolean(native) };
  });
}
export async function reconcileEntityJob(db, env, jobId, generation, options = {}) {
  const deadline = options.deadline ?? Date.now() + 45000,
    io = { ...options, deadline };
  const job = await claimSyncJob(db, env, jobId, generation);
  if (!job) return { status: 'not-claimed' };
  try {
    if (job.data.action === 'remove') return await markRemoval(db, env, job, io);
    await verifySourceOrganization(env, job.config.organizationId, io);
    if (job.data.side === 'native' && ['issues', 'comments'].includes(job.data.collection)) {
      const known = await db.transaction(
        (tx) => sourceMapping(tx, job.config, job.data.collection, job.data.sourceId),
        { readOnly: true },
      );
      if(!known){
        const allowed=await db.transaction(async tx=>{
          const row=await loadNative(tx,job.config,job.data.collection,job.data.targetId??job.data.sourceId);
          return nativeInScope(tx,job.config,job.data.collection,row);
        },{readOnly:true});
        if(!allowed)return db.transaction(async tx=>{await finishSyncJob(tx,job,{ignored:'out-of-scope'});return {status:'out-of-scope'};});
      }
      if (!known)
        return await (job.data.collection === 'issues' ? exportNativeIssue : exportNativeComment)(
          db,
          env,
          job,
          io,
        );
    }
    let remote = await readSourceEntity(env, job.data.collection, job.data.sourceId, io);
    assert(
      remote,
      404,
      'SOURCE_ABSENT_WITHOUT_REMOVAL',
      'The source record is unavailable; no deletion is inferred',
    );
    if(!await sourceInScope(db,env,job.config,job.data.collection,remote,io))return db.transaction(async tx=>{
      await finishSyncJob(tx,job,{ignored:'out-of-scope'});return {status:'out-of-scope'};
    });
    const lifecycle = await db.transaction(
      (tx) => readEntityState(tx, job.workspace_id, job.data.collection, remote.id),
      { readOnly: true },
    );
    if (lifecycle?.removedAt && Date.parse(remote.updatedAt) <= Date.parse(lifecycle.removedAt))
      return db.transaction(async (tx) => {
        await finishSyncJob(tx, job, { ignored: 'stale-after-removal' });
        return { status: 'stale' };
      });
    await ensureDependencies(db, env, job, remote, io);
    let context = await db.transaction(
      (tx) => contextFor(tx, job.config, job.data.collection, remote),
      { readOnly: true },
    );
    if (!context.native) {
      return db.transaction(async (tx) => {
        await assertJobFence(tx, job);
        const fresh = await contextFor(tx, job.config, job.data.collection, remote);
        if (fresh.native) throw new SourceError('SYNC_TARGET_CREATED_CONCURRENTLY', 1);
        const row = await createNativeSource(
          tx,
          job.config,
          job.data.collection,
          remote,
          fresh.source,
        );
        await writeEntityState(tx, job.workspace_id, job.data.collection, remote.id, {
          collection: job.data.collection,
          sourceId: remote.id,
          targetId: row.id,
          sourceUpdatedAt: remote.updatedAt,
          baseNative: fresh.source,
          baseSource: fresh.source,
          sourceCode: remote.identifier ?? null,
          nativeCode: row.key ?? null,
          conflicts: {},
        });
        await finishSyncJob(tx, job, { created: true, targetId: row.id });
        return { status: 'created' };
      });
    }
    const collection = job.data.collection;
    const state = await db.transaction(
      (tx) => readEntityState(tx, job.workspace_id, collection, remote.id),
      { readOnly: true },
    );
    if (state?.sourceUpdatedAt && Date.parse(remote.updatedAt) < Date.parse(state.sourceUpdatedAt))
      return db.transaction(async (tx) => {
        await finishSyncJob(tx, job, { ignored: 'stale-source-read' });
        return { status: 'stale' };
      });
    const original = normalizedSource(collection, context.original, context.resolver.resolve),
      fields = Object.keys(context.source),
      local = normalizedNative(collection, context.native, fields);
    const baseLocal = state?.baseNative ?? original,
      baseSource = state?.baseSource ?? original,
      conflicts = {},
      toNative = {},
      toSource = {};
    for (const field of fields) {
      const l = local[field],
        r = context.source[field];
      if (same(field, l, r)) continue;
      if (state?.conflicts?.[field]) {
        conflicts[field] = { ...state.conflicts[field], local: l, source: r };
        continue;
      }
      if (same(field, l, baseLocal[field])) toNative[field] = r;
      else if (same(field, r, baseSource[field])) toSource[field] = l;
      else conflicts[field] = { baseline: baseLocal[field], local: l, source: r };
    }
    const localFingerprint = digest(context.native);
    if (Object.keys(toSource).length) {
      const input = sourcePatch(collection, toSource, context.resolver);
      const checked = await readSourceEntity(env, collection, remote.id, io);
      if (!checked || checked.updatedAt !== remote.updatedAt)
        throw new SourceError('SOURCE_CHANGED_BEFORE_WRITE', 1);
      await db.transaction(async (tx) => {
        await assertJobFence(tx, job);
        const current = await loadNative(tx, job.config, collection, context.native.id);
        assert(
          digest(current) === localFingerprint,
          409,
          'VERSION_CONFLICT',
          'Native record changed before source write',
        );
        await writeEntityState(tx, job.workspace_id, collection, remote.id, {
          ...state,
          collection,
          sourceId: remote.id,
          targetId: context.native.id,
          baseNative: baseLocal,
          baseSource,
          conflicts,
          intent: {
            input,
            sourceBefore: remote,
            nativeBefore: context.native,
            createdAt: new Date().toISOString(),
          },
        });
      });
      remote = await mutateSource(env, collection, remote.id, input, io);
    }
    return await db.transaction(async (tx) => {
      await assertJobFence(tx, job);
      const live = await loadNative(tx, job.config, collection, context.native.id);
      assert(
        digest(live) === localFingerprint,
        409,
        'VERSION_CONFLICT',
        'Native record changed during source synchronization',
      );
      const updated = await applyNativePatch(tx, job.config, collection, live, toNative);
      const final =
        collection === 'issues' ? await assignLinearCode(tx, job.config, updated, remote) : updated;
      const finalLocal = normalizedNative(collection, final, fields),
        finalSource = normalizedSource(collection, remote, context.resolver.resolve);
      const nextBaseLocal = { ...baseLocal },
        nextBaseSource = { ...baseSource };
      for (const field of fields)
        if (!conflicts[field]) {
          nextBaseLocal[field] = finalLocal[field];
          nextBaseSource[field] = finalSource[field];
        }
      await writeEntityState(tx, job.workspace_id, collection, remote.id, {
        collection,
        sourceId: remote.id,
        targetId: final.id,
        sourceUpdatedAt: remote.updatedAt,
        baseNative: nextBaseLocal,
        baseSource: nextBaseSource,
        sourceCode: remote.identifier ?? null,
        nativeCode: final.key ?? null,
        removedAt: null,
        conflicts,
        lastAppliedAt: new Date().toISOString(),
      });
      await finishSyncJob(tx, job, {
        updatedNative: Object.keys(toNative),
        updatedSource: Object.keys(toSource),
        conflicts: Object.keys(conflicts),
      });
      return { status: Object.keys(conflicts).length ? 'conflict' : 'converged' };
    });
  } catch (error) {
    await failSyncJob(db, job, error);
    return { status: 'failed', code: error.code ?? 'SYNC_TRANSIENT_ERROR' };
  }
}
