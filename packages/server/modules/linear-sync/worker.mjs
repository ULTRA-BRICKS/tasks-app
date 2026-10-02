// Lease-fenced, idempotent, resumable worker over linear_webhook_inbox. Structurally
// mirrors packages/server/modules/integrations/service.mjs's runWorker: claim one row in a
// short transaction, do networked hydration OUTSIDE any transaction, then apply the domain
// write and mark the row done in ONE final transaction so success is tied to the commit.
import { id, now } from '../../core/crypto.mjs';
import { canonical, digest, targetId } from '../../../imports/linear-source.mjs';
import { validateReferences, replaceLabels } from '../tickets/service.mjs';
import { fetchIssue, fetchComment } from './client.mjs';
import { mapIssue, mapComment, ISSUE_MERGE_FIELDS, COMMENT_MERGE_FIELDS } from './map.mjs';
import { mergeFields } from './merge.mjs';

class SyncSignal extends Error {
  constructor(kind, message, retryAfterMs = null) {
    super(message);
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}

// --- hydration (networked, outside any transaction) ---------------------------------

function classifyHydration(classification, entityKey) {
  if (classification.kind === 'retryable')
    throw new SyncSignal('retryable', 'Linear API rate limited', classification.retryAfterMs);
  if (classification.kind === 'unauthorized')
    throw new SyncSignal('blocked', 'Linear API refused the request (unauthorized)');
  if (classification.kind === 'not_found') return { deleted: true };
  return { deleted: false, record: classification.data[entityKey] };
}

async function hydrateEntity(env, job, fetcher) {
  const payload = JSON.parse(job.payload);
  const sourceId = payload.data?.id;
  const entity = job.resource_type === 'Comment' ? 'comments' : 'issues';
  if (job.action === 'remove' || !sourceId) return { deleted: true, sourceId, entity };
  const { classification } =
    entity === 'comments'
      ? await fetchComment(env, sourceId, { fetcher })
      : await fetchIssue(env, sourceId, { fetcher });
  return { sourceId, entity, ...classifyHydration(classification, entity.slice(0, -1)) };
}

// --- resolver: linear_source_map, both directions, preloaded once per delivery ------

async function loadResolvers(tx, workspace, sourceWorkspaceId) {
  const rows = await tx.all(
    'SELECT collection,source_id,target_id FROM linear_source_map WHERE workspace_id=? AND source_workspace_id=?',
    [workspace, sourceWorkspaceId],
  );
  const forward = new Map(rows.map((r) => [r.collection + ':' + r.source_id, r.target_id]));
  const backward = new Map(rows.map((r) => [r.collection + ':' + r.target_id, r.source_id]));
  return {
    resolveRef: (collection, sourceId) => forward.get(collection + ':' + sourceId) ?? null,
    reverseRef: (collection, value) =>
      value == null ? null : (backward.get(collection + ':' + value) ?? null),
  };
}

// --- baseline bootstrap ---------------------------------------------------------------

async function loadBaseline(tx, ctx, collection, sourceId, mapping, mapFn) {
  if (mapping.local_snapshot) return JSON.parse(mapping.local_snapshot);
  const frozen = await tx.one(
    'SELECT payload FROM linear_import_records WHERE workspace_id=? AND import_id=? AND collection=? AND source_id=?',
    [ctx.actor.workspace_id, mapping.import_id, collection, sourceId],
  );
  if (!frozen) return null;
  const mapped = mapFn(JSON.parse(frozen.payload), ctx.resolveRef);
  return mapped.blocked ? null : mapped.fields;
}

// --- persistence helpers ---------------------------------------------------------------

async function touchSourceMap(tx, ctx, collection, sourceId, targetId_, fields, rawRecord) {
  await tx.exec(
    `INSERT INTO linear_source_map(workspace_id,source_workspace_id,collection,source_id,target_id,payload_hash,import_id,local_snapshot,source_deleted_at,synced_at)
     VALUES(?,?,?,?,?,?,?,?,NULL,?)
     ON CONFLICT(workspace_id,source_workspace_id,collection,source_id)
     DO UPDATE SET target_id=excluded.target_id,payload_hash=excluded.payload_hash,local_snapshot=excluded.local_snapshot,source_deleted_at=NULL,synced_at=excluded.synced_at`,
    [
      ctx.actor.workspace_id,
      ctx.completedImport.source_workspace_id,
      collection,
      sourceId,
      targetId_,
      digest(rawRecord),
      ctx.completedImport.id,
      JSON.stringify(fields),
      now(),
    ],
  );
  await tx.exec(
    `INSERT INTO linear_sync_records(workspace_id,source_workspace_id,collection,source_id,payload,payload_hash,fetched_at) VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(workspace_id,source_workspace_id,collection,source_id) DO UPDATE SET payload=excluded.payload,payload_hash=excluded.payload_hash,fetched_at=excluded.fetched_at`,
    [
      ctx.actor.workspace_id,
      ctx.completedImport.source_workspace_id,
      collection,
      sourceId,
      canonical(rawRecord),
      digest(rawRecord),
      now(),
    ],
  );
}
async function markSourceDeleted(tx, ctx, collection, sourceId) {
  await tx.exec(
    'UPDATE linear_source_map SET source_deleted_at=?,synced_at=? WHERE workspace_id=? AND source_workspace_id=? AND collection=? AND source_id=?',
    [
      now(),
      now(),
      ctx.actor.workspace_id,
      ctx.completedImport.source_workspace_id,
      collection,
      sourceId,
    ],
  );
}
async function recordConflicts(tx, ctx, collection, sourceId, targetId_, conflicts) {
  for (const c of conflicts)
    await tx.exec(
      'INSERT INTO linear_sync_conflicts(id,workspace_id,collection,source_id,target_id,field,baseline_value,local_value,remote_value,detected_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [
        id(),
        ctx.actor.workspace_id,
        collection,
        sourceId,
        targetId_,
        c.field,
        JSON.stringify(c.baseline_value ?? null),
        JSON.stringify(c.local_value ?? null),
        JSON.stringify(c.remote_value ?? null),
        now(),
      ],
    );
}
async function insertActivity(tx, ctx, issueId, data) {
  await tx.exec(
    'INSERT INTO activity(id,workspace_id,issue_id,actor_id,actor_source_id,action,data,created_at) VALUES(?,?,?,?,?,?,?,?)',
    [
      id(),
      ctx.actor.workspace_id,
      issueId,
      ctx.actor.id,
      ctx.actorSourceId,
      'linear_imported_change',
      JSON.stringify({ ...data, synced: true, delivery_id: ctx.deliveryId }),
      now(),
    ],
  );
}

// --- issue change description (source ids, matching activity.mjs's resolver contract) --

function issueChangeData(ctx, current, currentLabelIds, result, remoteRecord) {
  const data = {};
  const pair = (key, from, to) => {
    if (from !== to) {
      data['from' + key] = from;
      data['to' + key] = to;
    }
  };
  if (current) {
    pair(
      'StateId',
      ctx.reverseRef('workflowStates', current.status_id),
      remoteRecord.state?.id ?? null,
    );
    pair(
      'AssigneeId',
      ctx.reverseRef('users', current.assignee_source_id),
      remoteRecord.assignee?.id ?? null,
    );
    pair('Priority', current.priority, result.priority);
    pair('Title', current.title, result.title);
    pair(
      'ProjectId',
      ctx.reverseRef('projects', current.project_id),
      remoteRecord.project?.id ?? null,
    );
    pair('CycleId', ctx.reverseRef('cycles', current.cycle_id), remoteRecord.cycle?.id ?? null);
    pair(
      'ProjectMilestoneId',
      ctx.reverseRef('projectMilestones', current.milestone_id),
      remoteRecord.projectMilestone?.id ?? null,
    );
    pair('ParentId', ctx.reverseRef('issues', current.parent_id), remoteRecord.parent?.id ?? null);
    pair('Estimate', current.estimate, result.estimate);
    pair('DueDate', current.due_date, result.due_date);
    if (Boolean(current.archived_at) !== Boolean(result.archived_at))
      data.archived = Boolean(result.archived_at);
    const added = result.label_ids
      .filter((l) => !currentLabelIds.includes(l))
      .map((l) => ctx.reverseRef('issueLabels', l))
      .filter(Boolean);
    const removed = currentLabelIds
      .filter((l) => !result.label_ids.includes(l))
      .map((l) => ctx.reverseRef('issueLabels', l))
      .filter(Boolean);
    if (added.length) data.addedLabelIds = added;
    if (removed.length) data.removedLabelIds = removed;
  }
  if (result.trashed) data.trashed = true;
  return data;
}

// --- issue apply -------------------------------------------------------------------------

function issueRowToMergeFields(current, labelIds) {
  return {
    title: current.title,
    description: current.description,
    status_id: current.status_id,
    priority: current.priority,
    assignee_source_id: current.assignee_source_id,
    project_id: current.project_id,
    cycle_id: current.cycle_id,
    milestone_id: current.milestone_id,
    parent_id: current.parent_id,
    estimate: current.estimate,
    due_date: current.due_date,
    position: current.position,
    archived_at: current.archived_at,
    trashed: Boolean(current.deleted_at),
    label_ids: labelIds,
  };
}
function issueCandidate(targetId_, teamId, result) {
  return {
    id: targetId_,
    team_id: teamId,
    status_id: result.status_id,
    assignee_id: null,
    assignee_source_id: result.assignee_source_id,
    project_id: result.project_id,
    cycle_id: result.cycle_id,
    milestone_id: result.milestone_id,
    parent_id: result.parent_id,
    start_date: null,
    due_date: result.due_date,
  };
}
async function applyIssueUpdate(tx, ctx, hydrated, mapping, remoteFields) {
  const targetId_ = mapping.target_id;
  const current = await tx.one('SELECT * FROM issues WHERE workspace_id=? AND id=?', [
    ctx.actor.workspace_id,
    targetId_,
  ]);
  if (!current)
    return { blocked: true, code: 'MISSING_TARGET', detail: 'Mapped issue row no longer exists' };
  const currentLabelIds = (
    await tx.all('SELECT label_id FROM issue_labels WHERE workspace_id=? AND issue_id=?', [
      ctx.actor.workspace_id,
      targetId_,
    ])
  ).map((r) => r.label_id);
  const baseline = await loadBaseline(tx, ctx, 'issues', hydrated.sourceId, mapping, mapIssue);
  const local = issueRowToMergeFields(current, currentLabelIds);
  const { result, conflicts } = mergeFields(baseline, local, remoteFields, ISSUE_MERGE_FIELDS);
  await validateReferences(
    tx,
    ctx.actor,
    issueCandidate(targetId_, current.team_id, result),
    result.label_ids,
  );
  const deletedAt = result.trashed ? (current.deleted_at ?? remoteFields.updated_at) : null;
  const columns = [
    'title',
    'description',
    'status_id',
    'priority',
    'assignee_id',
    'assignee_source_id',
    'project_id',
    'cycle_id',
    'milestone_id',
    'parent_id',
    'estimate',
    'due_date',
    'position',
    'archived_at',
    'deleted_at',
  ];
  const values = { ...result, assignee_id: null, deleted_at: deletedAt };
  const update = await tx.exec(
    `UPDATE issues SET ${columns.map((c) => c + '=?').join(',')},version=version+1,updated_at=? WHERE workspace_id=? AND id=? AND version=?`,
    [...columns.map((c) => values[c]), now(), ctx.actor.workspace_id, targetId_, current.version],
  );
  if (Number(update.changes) !== 1)
    return {
      blocked: true,
      code: 'VERSION_RACE',
      detail: 'Concurrent local edit raced the sync write',
    };
  await replaceLabels(tx, ctx.actor, targetId_, result.label_ids);
  await recordConflicts(tx, ctx, 'issues', hydrated.sourceId, targetId_, conflicts);
  const changeData = issueChangeData(ctx, current, currentLabelIds, result, hydrated.record);
  await insertActivity(tx, ctx, targetId_, changeData);
  await touchSourceMap(tx, ctx, 'issues', hydrated.sourceId, targetId_, result, hydrated.record);
  return { blocked: false };
}
function newIssueRow(ctx, targetIssueId, fields) {
  return {
    id: targetIssueId,
    workspace_id: ctx.actor.workspace_id,
    team_id: fields.team_id,
    number: fields.number,
    key: fields.key,
    title: fields.title,
    description: fields.description,
    kind: 'issue',
    status_id: fields.status_id,
    priority: fields.priority,
    assignee_id: null,
    creator_id: ctx.actor.id,
    creator_source_id: fields.creator_source_id,
    assignee_source_id: fields.assignee_source_id,
    project_id: fields.project_id,
    cycle_id: fields.cycle_id,
    milestone_id: fields.milestone_id,
    parent_id: fields.parent_id,
    estimate: fields.estimate,
    start_date: null,
    due_date: fields.due_date,
    position: fields.position,
    version: 1,
    created_at: fields.created_at,
    updated_at: fields.updated_at,
    archived_at: fields.archived_at,
    deleted_at: fields.trashed ? fields.updated_at : null,
  };
}
async function linkAndBumpTeamNumber(tx, ctx, hydrated, fields, targetIssueId) {
  await tx.exec(
    'INSERT INTO external_links(id,workspace_id,issue_id,provider,external_id,url,title) VALUES(?,?,?,?,?,?,?) ON CONFLICT(workspace_id,provider,external_id,issue_id) DO NOTHING',
    [
      targetId(
        ctx.actor.workspace_id,
        ctx.completedImport.source_workspace_id,
        'linear-link',
        hydrated.sourceId,
      ),
      ctx.actor.workspace_id,
      targetIssueId,
      'linear',
      hydrated.sourceId,
      hydrated.record.url ?? `https://linear.app/issue/${fields.key}`,
      fields.key,
    ],
  );
  await tx.exec(
    'UPDATE teams SET next_number=CASE WHEN next_number<? THEN ? ELSE next_number END WHERE workspace_id=? AND id=?',
    [fields.number + 1, fields.number + 1, ctx.actor.workspace_id, fields.team_id],
  );
}
async function applyIssueCreate(tx, ctx, hydrated, fields) {
  const targetIssueId = targetId(
    ctx.actor.workspace_id,
    ctx.completedImport.source_workspace_id,
    'issues',
    hydrated.sourceId,
  );
  const existing = await tx.one(
    'SELECT id FROM issues WHERE workspace_id=? AND team_id=? AND (number=? OR key=?)',
    [ctx.actor.workspace_id, fields.team_id, fields.number, fields.key],
  );
  if (existing)
    return {
      blocked: true,
      code: existing.id === targetIssueId ? 'ALREADY_EXISTS_UNMAPPED' : 'NUMBER_COLLISION',
      detail: `Local issue already uses number/key ${fields.number}/${fields.key}`,
    };
  await validateReferences(
    tx,
    ctx.actor,
    issueCandidate(targetIssueId, fields.team_id, fields),
    fields.label_ids,
  );
  const row = newIssueRow(ctx, targetIssueId, fields);
  const columns = Object.keys(row);
  await tx.exec(
    `INSERT INTO issues(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
    Object.values(row),
  );
  await replaceLabels(tx, ctx.actor, targetIssueId, fields.label_ids);
  await tx.exec('INSERT INTO subscriptions(workspace_id,issue_id,user_id) VALUES(?,?,?)', [
    ctx.actor.workspace_id,
    targetIssueId,
    ctx.actor.id,
  ]);
  await linkAndBumpTeamNumber(tx, ctx, hydrated, fields, targetIssueId);
  await insertActivity(tx, ctx, targetIssueId, {});
  await touchSourceMap(
    tx,
    ctx,
    'issues',
    hydrated.sourceId,
    targetIssueId,
    fields,
    hydrated.record,
  );
  return { blocked: false };
}
async function tombstoneIssue(tx, ctx, sourceId) {
  const mapping = await tx.one(
    'SELECT target_id FROM linear_source_map WHERE workspace_id=? AND source_workspace_id=? AND collection=? AND source_id=?',
    [ctx.actor.workspace_id, ctx.completedImport.source_workspace_id, 'issues', sourceId],
  );
  if (!mapping) return { blocked: false };
  const current = await tx.one(
    'SELECT id,version,deleted_at FROM issues WHERE workspace_id=? AND id=?',
    [ctx.actor.workspace_id, mapping.target_id],
  );
  if (current && !current.deleted_at) {
    await tx.exec(
      'UPDATE issues SET deleted_at=?,version=version+1,updated_at=? WHERE workspace_id=? AND id=? AND version=?',
      [now(), now(), ctx.actor.workspace_id, mapping.target_id, current.version],
    );
    await insertActivity(tx, ctx, mapping.target_id, { trashed: true });
  }
  await markSourceDeleted(tx, ctx, 'issues', sourceId);
  return { blocked: false };
}
async function applyIssueDelivery(tx, ctx, hydrated) {
  try {
    if (hydrated.deleted) return await tombstoneIssue(tx, ctx, hydrated.sourceId);
    const mapped = mapIssue(hydrated.record, ctx.resolveRef);
    if (mapped.blocked)
      return { blocked: true, code: 'MISSING_REFERENCE', detail: mapped.missing.join(',') };
    const mapping = await tx.one(
      'SELECT target_id,local_snapshot,import_id FROM linear_source_map WHERE workspace_id=? AND source_workspace_id=? AND collection=? AND source_id=?',
      [
        ctx.actor.workspace_id,
        ctx.completedImport.source_workspace_id,
        'issues',
        hydrated.sourceId,
      ],
    );
    return mapping
      ? await applyIssueUpdate(tx, ctx, hydrated, mapping, mapped.fields)
      : await applyIssueCreate(tx, ctx, hydrated, mapped.fields);
  } catch (error) {
    if (error?.status === 422) return { blocked: true, code: error.code, detail: error.message };
    throw error;
  }
}

// --- comment apply -----------------------------------------------------------------------

async function applyCommentUpdate(tx, ctx, hydrated, mapping, remoteFields) {
  const current = await tx.one('SELECT * FROM comments WHERE workspace_id=? AND id=?', [
    ctx.actor.workspace_id,
    mapping.target_id,
  ]);
  if (!current)
    return { blocked: true, code: 'MISSING_TARGET', detail: 'Mapped comment row no longer exists' };
  const baseline = await loadBaseline(tx, ctx, 'comments', hydrated.sourceId, mapping, mapComment);
  const local = { body: current.body, author_source_id: current.author_source_id };
  const { result, conflicts } = mergeFields(baseline, local, remoteFields, COMMENT_MERGE_FIELDS);
  const update = await tx.exec(
    'UPDATE comments SET body=?,author_source_id=?,version=version+1,updated_at=? WHERE workspace_id=? AND id=? AND version=?',
    [
      result.body,
      result.author_source_id,
      now(),
      ctx.actor.workspace_id,
      mapping.target_id,
      current.version,
    ],
  );
  if (Number(update.changes) !== 1)
    return {
      blocked: true,
      code: 'VERSION_RACE',
      detail: 'Concurrent local edit raced the sync write',
    };
  await recordConflicts(tx, ctx, 'comments', hydrated.sourceId, mapping.target_id, conflicts);
  await insertActivity(tx, ctx, current.issue_id, { commented: true });
  await touchSourceMap(
    tx,
    ctx,
    'comments',
    hydrated.sourceId,
    mapping.target_id,
    result,
    hydrated.record,
  );
  return { blocked: false };
}
async function applyCommentCreate(tx, ctx, hydrated, fields) {
  const targetCommentId = targetId(
    ctx.actor.workspace_id,
    ctx.completedImport.source_workspace_id,
    'comments',
    hydrated.sourceId,
  );
  const created = now();
  await tx.exec(
    'INSERT INTO comments(id,workspace_id,issue_id,author_id,author_source_id,body,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,1)',
    [
      targetCommentId,
      ctx.actor.workspace_id,
      fields.issue_id,
      ctx.actor.id,
      fields.author_source_id,
      fields.body,
      fields.created_at ?? created,
      fields.updated_at ?? created,
    ],
  );
  await insertActivity(tx, ctx, fields.issue_id, { commented: true });
  await touchSourceMap(
    tx,
    ctx,
    'comments',
    hydrated.sourceId,
    targetCommentId,
    fields,
    hydrated.record,
  );
  return { blocked: false };
}
async function tombstoneComment(tx, ctx, sourceId) {
  await markSourceDeleted(tx, ctx, 'comments', sourceId);
  return { blocked: false };
}
async function applyCommentDelivery(tx, ctx, hydrated) {
  try {
    if (hydrated.deleted) return await tombstoneComment(tx, ctx, hydrated.sourceId);
    const mapped = mapComment(hydrated.record, ctx.resolveRef);
    if (mapped.blocked)
      return { blocked: true, code: 'MISSING_REFERENCE', detail: mapped.missing.join(',') };
    const mapping = await tx.one(
      'SELECT target_id,local_snapshot,import_id FROM linear_source_map WHERE workspace_id=? AND source_workspace_id=? AND collection=? AND source_id=?',
      [
        ctx.actor.workspace_id,
        ctx.completedImport.source_workspace_id,
        'comments',
        hydrated.sourceId,
      ],
    );
    return mapping
      ? await applyCommentUpdate(tx, ctx, hydrated, mapping, mapped.fields)
      : await applyCommentCreate(tx, ctx, hydrated, mapped.fields);
  } catch (error) {
    if (error?.status === 422) return { blocked: true, code: error.code, detail: error.message };
    throw error;
  }
}

// --- orchestration -------------------------------------------------------------------------

async function applyInboxRow(tx, job, hydrated, webhookPayload) {
  const live = await tx.one('SELECT status FROM linear_webhook_inbox WHERE id=?', [job.id]);
  if (live?.status !== 'processing') return { skipped: true };
  const workspace = job.workspace_id;
  await tx.lock(workspace);
  const completedImport = await tx.one(
    "SELECT id,source_workspace_id,created_by FROM linear_imports WHERE workspace_id=? AND status='completed' ORDER BY completed_at DESC LIMIT 1",
    [workspace],
  );
  if (!completedImport || completedImport.source_workspace_id !== job.organization_id) {
    await tx.exec("UPDATE linear_webhook_inbox SET status='blocked',last_error=? WHERE id=?", [
      'ORG_MISMATCH',
      job.id,
    ]);
    return { blocked: true, code: 'ORG_MISMATCH' };
  }
  const { resolveRef, reverseRef } = await loadResolvers(
    tx,
    workspace,
    completedImport.source_workspace_id,
  );
  const actor = { id: completedImport.created_by, workspace_id: workspace };
  const actorSourceId = webhookPayload?.actor?.id
    ? resolveRef('users', webhookPayload.actor.id)
    : null;
  const ctx = {
    actor,
    completedImport,
    resolveRef,
    reverseRef,
    deliveryId: job.delivery_id,
    actorSourceId,
  };
  const outcome =
    hydrated.entity === 'issues'
      ? await applyIssueDelivery(tx, ctx, hydrated)
      : await applyCommentDelivery(tx, ctx, hydrated);
  await tx.exec('UPDATE linear_webhook_inbox SET status=?,last_error=? WHERE id=?', [
    outcome.blocked ? 'blocked' : 'done',
    outcome.blocked ? (outcome.code ?? 'BLOCKED') : null,
    job.id,
  ]);
  return outcome;
}
async function claimNextInboxRow(db) {
  return db.transaction(async (tx) => {
    await tx.lock('tickets-app:linear-sync:worker');
    const row = await tx.one(
      "SELECT * FROM linear_webhook_inbox WHERE status IN ('pending','processing') AND next_attempt_at<=? ORDER BY created_at,id LIMIT 1",
      [now()],
    );
    if (!row) return null;
    await tx.exec(
      "UPDATE linear_webhook_inbox SET status='processing',attempts=attempts+1,next_attempt_at=? WHERE id=?",
      [new Date(Date.now() + 60000).toISOString(), row.id],
    );
    return { ...row, attempts: row.attempts + 1 };
  });
}
async function recordFailure(db, job, error) {
  const signal = error instanceof SyncSignal ? error : null;
  const blocked = signal?.kind === 'blocked';
  const nextDelayMs = signal?.retryAfterMs ?? Math.min(3600, 2 ** job.attempts * 15) * 1000;
  await db.transaction((tx) =>
    tx.exec('UPDATE linear_webhook_inbox SET status=?,next_attempt_at=?,last_error=? WHERE id=?', [
      blocked ? 'blocked' : job.attempts >= 8 ? 'failed' : 'pending',
      new Date(Date.now() + nextDelayMs).toISOString(),
      signal?.kind ?? error?.code ?? 'SYNC_FAILED',
      job.id,
    ]),
  );
}
export async function runLinearSyncWorker(db, env, { limit = 10, fetcher = fetch } = {}) {
  const results = { processed: 0, blocked: 0, failed: 0 };
  for (let n = 0; n < limit; n++) {
    const job = await claimNextInboxRow(db);
    if (!job) break;
    try {
      const webhookPayload = JSON.parse(job.payload);
      const hydrated = await hydrateEntity(env, job, fetcher);
      const outcome = await db.transaction((tx) =>
        applyInboxRow(tx, job, hydrated, webhookPayload),
      );
      if (outcome?.blocked) results.blocked++;
      else if (!outcome?.skipped) results.processed++;
    } catch (error) {
      await recordFailure(db, job, error);
      results.failed++;
    }
  }
  return results;
}
