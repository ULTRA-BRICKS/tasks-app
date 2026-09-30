import { assert } from '../../core/errors.mjs';
import { digest } from '../../../imports/linear-source.mjs';
import { markdownEquivalent } from '../linear-import/source-contract.mjs';
import { requestLinear, readSourceEntity, SOURCE_MODELS } from './client.mjs';
import { loadNative, referenceResolver, registerSource, normalizedNative } from './context.mjs';
import {
  assertJobFence,
  readCreationIntent,
  readEntityState,
  writeEntityState,
  finishSyncJob,
} from './store.mjs';
import { normalizedSource } from './model.mjs';
const TYPES = Object.freeze({
  projects: 'Project',
  documents: 'Document',
  initiatives: 'Initiative',
  issueLabels: 'IssueLabel',
  workflowStates: 'WorkflowState',
  cycles: 'Cycle',
  projectMilestones: 'ProjectMilestone',
});
const STATUSES = Object.freeze({
  planned: 'Planned',
  active: 'Active',
  completed: 'Completed',
  canceled: 'Canceled',
});
function createInput(collection, row, resolver) {
  const reverse = (kind, id) => (id == null ? null : resolver.reverse(kind, id));
  if (collection === 'issueLabels') return { id: row.id, name: row.name, color: row.color };
  if (collection === 'workflowStates')
    return {
      id: row.id,
      name: row.name,
      color: row.color,
      type: row.category,
      position: row.position,
      teamId: reverse('teams', row.team_id),
    };
  if (collection === 'cycles')
    return {
      id: row.id,
      name: row.name,
      teamId: reverse('teams', row.team_id),
      startsAt: row.start_date + 'T00:00:00.000Z',
      endsAt: row.end_date + 'T00:00:00.000Z',
    };
  if (collection === 'projectMilestones')
    return {
      id: row.id,
      name: row.name,
      projectId: reverse('projects', row.project_id),
      targetDate: row.target_date,
      sortOrder: row.position,
    };
  if (collection === 'projects')
    return {
      id: row.id,
      name: row.name,
      content: row.description,
      teamIds: row.team_ids.map((id) => reverse('teams', id)),
      leadId: reverse('users', row.lead_id ?? row.lead_source_id),
      startDate: row.start_date,
      targetDate: row.target_date,
    };
  if (collection === 'documents')
    return {
      id: row.id,
      title: row.title,
      content: row.body,
      projectId: reverse('projects', row.project_id),
      initiativeId: reverse('initiatives', row.initiative_id),
    };
  assert(
    Object.hasOwn(STATUSES, row.status),
    422,
    'SYNC_STATUS_INVALID',
    'Unknown native initiative status',
  );
  return {
    id: row.id,
    name: row.name,
    content: row.description,
    status: STATUSES[row.status],
    ownerId: reverse('users', row.owner_id ?? row.owner_source_id),
    targetDate: row.target_date,
  };
}
export async function exportNativeMetadata(db, env, job, options = {}) {
  const collection = job.data.collection,
    type = TYPES[collection];
  assert(type, 422, 'SYNC_EXPORT_UNSUPPORTED', 'This native model has no export contract');
  const target = job.data.targetId ?? job.data.sourceId,
    model = SOURCE_MODELS[collection];
  const prepared = await db.transaction(async (tx) => {
    await assertJobFence(tx, job);
    const native = await loadNative(tx, job.config, collection, target);
    assert(native, 404, 'SYNC_TARGET_ABSENT', 'Native metadata is unavailable');
    const resolver = await referenceResolver(tx, job.config, collection, null, null, native);
    const intent = await readCreationIntent(tx, job.workspace_id, collection, target);
    return {
      native,
      original: intent ? intent.nativeBefore : native,
      input: createInput(collection, native, resolver),
      fingerprint: digest(native),
      createdHere: Boolean(intent),
    };
  });
  const page = (
    await requestLinear(
      env,
      `query SyncFindMetadata($id:ID!){${model.many}(first:1,includeArchived:true,filter:{id:{eq:$id}}){nodes{${model.fields}}}}`,
      { id: target },
      options,
    )
  )[model.many];
  assert(
    Array.isArray(page?.nodes) && page.nodes.length <= 1,
    422,
    'SOURCE_LOOKUP_INVALID',
    'Invalid source UUID lookup',
  );
  let record = page.nodes[0];
  if (!record) {
    prepared.original = prepared.native;
    prepared.createdHere = true;
    if (collection === 'projects') {
      const list = (
        await requestLinear(
          env,
          'query SyncProjectStatuses{projectStatuses(first:100){nodes{id type}pageInfo{hasNextPage}}}',
          {},
          options,
        )
      ).projectStatuses;
      assert(
        Array.isArray(list?.nodes) && list.pageInfo?.hasNextPage === false,
        422,
        'SOURCE_STATUS_PAGINATION',
        'Project statuses were not fully enumerated',
      );
      const wanted = {
        planned: ['planned', 'backlog'],
        in_progress: ['started'],
        paused: ['paused'],
        completed: ['completed'],
        canceled: ['canceled'],
      }[prepared.native.status];
      assert(wanted, 422, 'SYNC_STATUS_INVALID', 'Unknown native project status');
      const status = wanted.flatMap((type) => list.nodes.filter((item) => item.type === type))[0];
      assert(
        status,
        409,
        'SYNC_PROJECT_STATUS_UNMAPPED',
        'No source project status matches the native state',
      );
      prepared.input.statusId = status.id;
    }
    await db.transaction(async (tx) => {
      await assertJobFence(tx, job);
      assert(
        digest(await loadNative(tx, job.config, collection, target)) === prepared.fingerprint,
        409,
        'VERSION_CONFLICT',
        'Metadata changed before source creation',
      );
      const previous = await readEntityState(tx, job.workspace_id, collection, target);
      await writeEntityState(tx, job.workspace_id, collection, target, {
        ...previous,
        collection,
        sourceId: target,
        targetId: target,
        intent: {
          kind: 'create',
          input: prepared.input,
          nativeBefore: prepared.native,
          at: new Date().toISOString(),
        },
      });
    });
    const outcome = (
      await requestLinear(
        env,
        `mutation SyncCreateMetadata($input:${type}CreateInput!){${model.one}Create(input:$input){success ${model.one}{${model.fields}}}}`,
        { input: prepared.input },
        options,
      )
    )[model.one + 'Create'];
    assert(
      outcome?.success && outcome[model.one]?.id === target,
      502,
      'SOURCE_CREATE_UNCONFIRMED',
      'Source metadata creation was not confirmed',
    );
    record = outcome[model.one];
  }
  // Content identifies only a record we did not create (see readCreationIntent); the
  // normalization difference is recorded below as a source-create-normalization conflict.
  assert(
    record.id === target &&
      (prepared.createdHere ||
        ((record.title ?? record.name) === (prepared.original.title ?? prepared.original.name) &&
          markdownEquivalent(
            record.content ?? record.description ?? '',
            prepared.original.body ?? prepared.original.description ?? '',
          ))),
    409,
    'SOURCE_IDENTITY_CONFLICT',
    'Source UUID has a different title or body',
  );
  if (
    prepared.original.archived_at &&
    !record.archivedAt &&
    ['projects', 'initiatives'].includes(collection)
  ) {
    const mutation = model.one + 'Archive';
    const outcome = await requestLinear(
      env,
      `mutation SyncArchiveMetadata($id:String!){${mutation}(id:$id){success}}`,
      { id: target },
      options,
    );
    assert(
      outcome[mutation]?.success,
      502,
      'SOURCE_ARCHIVE_UNCONFIRMED',
      'Source archive operation was not confirmed',
    );
  }
  record = await readSourceEntity(env, collection, target, options);
  assert(record, 502, 'SOURCE_READBACK_ABSENT', 'Created source metadata could not be read back');
  return db.transaction(async (tx) => {
    await assertJobFence(tx, job);
    const current = await loadNative(tx, job.config, collection, target);
    assert(
      digest(current) === prepared.fingerprint,
      409,
      'VERSION_CONFLICT',
      'Metadata changed during source creation',
    );
    await registerSource(tx, job.config, collection, record, target);
    const resolver = await referenceResolver(tx, job.config, collection, record, record, current);
    const source = normalizedSource(collection, record, resolver.resolve),
      native = normalizedNative(collection, current, Object.keys(source)),
      originalNative = normalizedNative(collection, prepared.original, Object.keys(source)),
      conflicts = {};
    for (const field of Object.keys(source)) {
      // A confirmed create may reserialize authored Markdown. Preserve the distinct
      // baselines, as for issue/comment creation, without freezing subsequent edits.
      // Dates, ownership and other source defaults remain explicit conflicts.
      if (prepared.createdHere && ['description', 'body'].includes(field)) continue;
      const equal = ['description', 'body'].includes(field)
        ? markdownEquivalent(originalNative[field], source[field])
        : digest(originalNative[field]) === digest(source[field]);
      if (!equal)
        conflicts[field] = {
          local: native[field],
          source: source[field],
          reason: 'source-create-normalization',
        };
    }
    await writeEntityState(tx, job.workspace_id, collection, target, {
      collection,
      sourceId: target,
      targetId: target,
      sourceUpdatedAt: record.updatedAt,
      baseNative: originalNative,
      baseSource: source,
      conflicts,
    });
    await finishSyncJob(tx, job, { exported: true, conflicts: Object.keys(conflicts) });
    return { status: 'exported', conflicts: Object.keys(conflicts) };
  });
}
