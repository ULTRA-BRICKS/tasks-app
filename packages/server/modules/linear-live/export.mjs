import { assert } from '../../core/errors.mjs';
import { digest } from '../../../imports/linear-source.mjs';
import { markdownEquivalent } from '../linear-import/source-contract.mjs';
import { requestLinear, SOURCE_MODELS } from './client.mjs';
import { loadNative, referenceResolver, registerSource, normalizedNative } from './context.mjs';
import { assertJobFence, readEntityState, writeEntityState, finishSyncJob } from './store.mjs';
import { assignLinearCode } from './domain.mjs';
import { normalizedSource } from './model.mjs';
export async function exportNativeIssue(db, env, job, options) {
  const target = job.data.targetId ?? job.data.sourceId;
  const prepared = await db.transaction(async (tx) => {
    await assertJobFence(tx, job);
    const native = await loadNative(tx, job.config, 'issues', target);
    assert(native, 404, 'SYNC_TARGET_ABSENT', 'Native issue is absent');
    assert(
      !native.deleted_at,
      409,
      'SYNC_LOCAL_REMOVAL',
      'Deleted native issue must not be created in Linear',
    );
    const resolver = await referenceResolver(tx, job.config, 'issues', null, null, native);
    const reverse = (kind, id) => (id == null ? null : resolver.reverse(kind, id));
    const input = {
      id: target,
      teamId: reverse('teams', native.team_id),
      title: native.title,
      description: native.description,
      stateId: reverse('workflowStates', native.status_id),
      priority: native.priority,
      createdAt: native.created_at,
      labelIds: (native.label_ids ?? []).map((id) => reverse('issueLabels', id)),
    };
    for (const [field, source, kind] of [
      ['project_id', 'projectId', 'projects'],
      ['parent_id', 'parentId', 'issues'],
      ['cycle_id', 'cycleId', 'cycles'],
      ['milestone_id', 'projectMilestoneId', 'projectMilestones'],
    ])
      if (native[field]) input[source] = reverse(kind, native[field]);
    const assignee = native.assignee_id ?? native.assignee_source_id;
    if (assignee) input.assigneeId = reverse('users', assignee);
    if (native.due_date) input.dueDate = native.due_date;
    if (native.estimate !== null) input.estimate = native.estimate;
    const state = await readEntityState(tx, job.workspace_id, 'issues', target);
    await writeEntityState(tx, job.workspace_id, 'issues', target, {
      ...state,
      collection: 'issues',
      sourceId: target,
      targetId: target,
      intent: { kind: 'create', input, nativeBefore: native, at: new Date().toISOString() },
    });
    return { native, input, fingerprint: digest(native) };
  });
  const existing = (
    await requestLinear(
      env,
      'query SyncFindIssue($id:ID!){issues(first:1,includeArchived:true,filter:{id:{eq:$id}}){nodes{' +
        SOURCE_MODELS.issues.fields +
        '}}}',
      { id: target },
      options,
    )
  ).issues;
  assert(
    Array.isArray(existing?.nodes) && existing.nodes.length <= 1,
    422,
    'SOURCE_LOOKUP_INVALID',
    'Invalid UUID lookup',
  );
  let record = existing.nodes[0];
  if (!record) {
    const result = (
      await requestLinear(
        env,
        'mutation SyncCreateIssue($input:IssueCreateInput!){issueCreate(input:$input){success issue{' +
          SOURCE_MODELS.issues.fields +
          '}}}',
        { input: prepared.input },
        options,
      )
    ).issueCreate;
    assert(
      result?.success && result.issue?.id === target,
      502,
      'SOURCE_CREATE_UNCONFIRMED',
      'Source issue creation was not confirmed',
    );
    record = result.issue;
  }
  assert(
    record.id === target &&
      record.title === prepared.native.title &&
      markdownEquivalent(record.description ?? '', prepared.native.description),
    409,
    'SOURCE_IDENTITY_CONFLICT',
    'Existing source UUID has different content; explicit reconciliation is required',
  );
  if (prepared.native.archived_at && !record.archivedAt) {
    const result = await requestLinear(
      env,
      'mutation SyncArchive($id:String!){issueArchive(id:$id){success}}',
      { id: target },
      options,
    );
    assert(
      result.issueArchive?.success,
      502,
      'SOURCE_ARCHIVE_UNCONFIRMED',
      'Archive state was not confirmed',
    );
    record.archivedAt = prepared.native.archived_at;
  }
  return db.transaction(async (tx) => {
    await assertJobFence(tx, job);
    const current = await loadNative(tx, job.config, 'issues', target);
    assert(
      digest(current) === prepared.fingerprint,
      409,
      'VERSION_CONFLICT',
      'Native issue changed during source creation',
    );
    await registerSource(tx, job.config, 'issues', record, target);
    const resolver = await referenceResolver(tx, job.config, 'issues', record, record, current),
      source = normalizedSource('issues', record, resolver.resolve);
    const numbered = await assignLinearCode(tx, job.config, current, record);
    await tx.exec(
      "INSERT INTO external_links(id,workspace_id,issue_id,provider,external_id,url,title) VALUES(?,?,?,'linear',?,?,?) ON CONFLICT(workspace_id,provider,external_id,issue_id) DO NOTHING",
      [
        targetIdForLink(job, target),
        job.workspace_id,
        target,
        target,
        record.url ?? 'https://linear.app/issue/' + record.identifier,
        record.identifier,
      ],
    );
    await writeEntityState(tx, job.workspace_id, 'issues', target, {
      collection: 'issues',
      sourceId: target,
      targetId: target,
      sourceCode: record.identifier,
      nativeCode: numbered.key,
      sourceUpdatedAt: record.updatedAt,
      baseNative: normalizedNative('issues', numbered, Object.keys(source)),
      baseSource: source,
      conflicts: {},
    });
    await finishSyncJob(tx, job, { exported: true, code: record.identifier });
    return { status: 'exported' };
  });
}
import { targetId } from '../../../imports/linear-source.mjs';
const targetIdForLink = (job, key) =>
  targetId(job.workspace_id, job.config.organizationId, 'linear-link', key);

export async function exportNativeComment(db, env, job, options) {
  const target = job.data.targetId ?? job.data.sourceId;
  const prepared = await db.transaction(async (tx) => {
    await assertJobFence(tx, job);
    const row = await loadNative(tx, job.config, 'comments', target);
    assert(row, 404, 'SYNC_TARGET_ABSENT', 'Comment is unavailable');
    assert(
      row.author_id === job.config.userId,
      409,
      'SYNC_AUTHOR_CONTEXT_REQUIRED',
      'Source token cannot impersonate another native comment author',
    );
    const resolver = await referenceResolver(tx, job.config, 'comments', null, null, row);
    const input = {
      id: target,
      issueId: resolver.reverse('issues', row.issue_id),
      body: row.body,
      createdAt: row.created_at,
    };
    return { row, input, fingerprint: digest(row) };
  });
  const page = (
    await requestLinear(
      env,
      'query SyncFindComment($id:ID!){comments(first:1,includeArchived:true,filter:{id:{eq:$id}}){nodes{' +
        SOURCE_MODELS.comments.fields +
        '}}}',
      { id: target },
      options,
    )
  ).comments;
  assert(
    Array.isArray(page?.nodes) && page.nodes.length <= 1,
    422,
    'SOURCE_LOOKUP_INVALID',
    'Invalid comment lookup',
  );
  let record = page.nodes[0];
  if (!record) {
    const outcome = (
      await requestLinear(
        env,
        'mutation SyncCreateComment($input:CommentCreateInput!){commentCreate(input:$input){success comment{' +
          SOURCE_MODELS.comments.fields +
          '}}}',
        { input: prepared.input },
        options,
      )
    ).commentCreate;
    assert(
      outcome?.success,
      502,
      'SOURCE_CREATE_UNCONFIRMED',
      'Source comment creation was not confirmed',
    );
    record = outcome.comment;
  }
  assert(
    record?.id === target &&
      record.issue?.id === prepared.input.issueId &&
      markdownEquivalent(record.body, prepared.row.body),
    409,
    'SOURCE_IDENTITY_CONFLICT',
    'Source comment UUID does not match the native comment',
  );
  return db.transaction(async (tx) => {
    await assertJobFence(tx, job);
    const current = await loadNative(tx, job.config, 'comments', target);
    assert(
      digest(current) === prepared.fingerprint,
      409,
      'VERSION_CONFLICT',
      'Comment changed during export',
    );
    await registerSource(tx, job.config, 'comments', record, target);
    const base = { body: current.body, issue_id: current.issue_id };
    await writeEntityState(tx, job.workspace_id, 'comments', target, {
      collection: 'comments',
      sourceId: target,
      targetId: target,
      sourceUpdatedAt: record.updatedAt,
      baseNative: base,
      baseSource: { ...base, body: record.body },
      conflicts: {},
    });
    await finishSyncJob(tx, job, { exported: true });
    return { status: 'exported' };
  });
}
