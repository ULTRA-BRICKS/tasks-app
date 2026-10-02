// Lease-fenced, idempotent, resumable worker over linear_webhook_inbox. Structurally
// mirrors packages/server/modules/integrations/service.mjs's runWorker: claim one row in a
// short transaction, do networked hydration OUTSIDE any transaction, then apply the domain
// write and mark the row done in ONE final transaction so success is tied to the commit.
//
// Deletion/restore: a verified `Issue:remove`/`Comment:remove` delivery (proof is the
// signed webhook itself — never an absent/forbidden READ, which stays exactly what it
// already was: a BLOCKED update, native content untouched) sets a MARKER
// (linear_source_map.source_deleted_at, or linear_removal_receipts for a source id that
// was never imported/mapped) — it never hard- or soft-deletes the native row. A remove
// delivery makes ZERO calls to fetchIssue/fetchComment (see hydrateEntity): the entity is
// gone, so a read would only ever come back not_found/blocked, and treating that as
// confirmation would collapse the remove path into the unrelated blocked-read path this
// module has always kept separate. A later UPDATE whose own `updatedAt` is newer than the
// remove's `createdAt` is an IMPLICIT RESTORE (see applyRemove/handleImplicitRestore);
// older/equal is a stale delivery that must never resurrect a removed item. A source issue
// reported as currently trashed is a SEPARATE, older safety guard (see applyIssueDelivery)
// — conservative blocking, not removal semantics.
import { id, now } from '../../core/crypto.mjs';
import { canonical, digest, targetId } from '../../../imports/linear-source.mjs';
import { validateReferences, replaceLabels } from '../tickets/service.mjs';
import { fetchIssue, fetchComment, fetchOrganizationId } from './client.mjs';
import {
  mapIssue,
  mapComment,
  ISSUE_MERGE_FIELDS,
  COMMENT_MERGE_FIELDS,
  isValidDateString,
} from './map.mjs';
import { mergeFields } from './merge.mjs';

class SyncSignal extends Error {
  constructor(kind, message, { retryAfterMs = null, code = null } = {}) {
    super(message);
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
    this.code = code;
  }
}
// Terminal: only clears via manual admin retry (claimNextInboxRow only ever selects
// pending/processing rows).
const blocked = (message, code) => new SyncSignal('blocked', message, { code });
// Transient: routes through the SAME pending+backoff+eventually-'failed'-after-8-attempts
// lifecycle as any other retryable error. Stale-updatedAt and optimistic-lock version
// races are not poisoned payloads — they're plausibly self-resolving (replica lag, clock
// skew, an ordinary concurrent edit) and must never get stuck waiting on an admin.
const transient = (message, code) => new SyncSignal('retryable', message, { code });
// mapIssue/mapComment distinguish a genuinely malformed source payload (a mandatory,
// schema-guaranteed-non-null field is absent or invalid — never legitimate, always a
// corrupt/unexpected response) from an unresolved-but-valid reference (a real, optional
// field pointing at something not yet synced). Different blocked codes so an operator
// can tell "this payload is broken" apart from "this will self-heal once the dependency
// syncs".
function throwIfMapBlocked(mapped) {
  if (!mapped.blocked) return;
  if (mapped.malformed?.length)
    throw blocked(mapped.malformed.join(','), 'MALFORMED_SOURCE_PAYLOAD');
  throw blocked(mapped.missing.join(','), 'MISSING_REFERENCE');
}

// One lock name shared by every function that claims, applies, or fails a row for this
// workspace's inbox. claimNextInboxRow, applyInboxRow and recordFailure MUST all pass this
// exact key to tx.lock — a mismatched key (e.g. the bare workspace id) doesn't serialize
// against the others on Postgres (SQLite hides this: its tx.lock is a no-op there because
// the whole database is already globally mutexed, so a key mismatch is invisible in tests
// unless asserted structurally — see the "lock key contract" test).
export function workerLockKey(workspace) {
  return 'tickets-app:linear-sync:worker:' + workspace;
}

// --- canonical organization pinning (networked, once per worker run) -----------------

// Cheap client-side existence memo across the whole limit-bounded run; unsupported and
// already-blocked rows never reach here since only a claimed pending/processing row does.
async function resolveCanonicalOrganizationId(env, fetcher) {
  const { classification } = await fetchOrganizationId(env, { fetcher });
  if (classification.kind === 'retryable')
    throw new SyncSignal('retryable', 'Linear API rate limited', {
      retryAfterMs: classification.retryAfterMs,
    });
  if (classification.kind === 'ok') return classification.data.organization.id;
  throw blocked('Linear API organization check failed', 'ORG_CHECK_FAILED');
}

// --- hydration (networked, outside any transaction) ---------------------------------

function classifyHydration(classification, entityKey) {
  if (classification.kind === 'retryable')
    throw new SyncSignal('retryable', 'Linear API rate limited', {
      retryAfterMs: classification.retryAfterMs,
    });
  if (classification.kind === 'unauthorized')
    throw blocked('Linear API refused the request (unauthorized)', 'UNAUTHORIZED');
  // Any application-level GraphQL error, OR an absent/null entity, is a BLOCKED read —
  // never a verified deletion signal (deletions are out of scope for this pass entirely).
  if (classification.kind === 'blocked' || classification.kind === 'not_found')
    throw blocked(
      'Linear API read was absent or blocked; content left untouched',
      'SOURCE_READ_BLOCKED',
    );
  return classification.data[entityKey];
}

async function hydrateEntity(env, job, fetcher) {
  const payload = JSON.parse(job.payload);
  const sourceId = payload.data?.id;
  const entity = job.resource_type === 'Comment' ? 'comments' : 'issues';
  if (!sourceId) throw blocked('Delivery payload is missing a source id', 'MISSING_SOURCE_ID');
  if (job.action === 'remove') {
    // Proof of deletion is the signed webhook delivery itself (verified in webhook.mjs
    // before this row was ever queued) — never a source READ, which is unreliable proof
    // either way (absent could mean deleted OR merely inaccessible) and is exactly the
    // ambiguity classifyHydration's SOURCE_READ_BLOCKED already refuses to resolve as a
    // deletion. Grep-provable: this branch never calls fetchIssue/fetchComment.
    if (!isValidDateString(payload.createdAt))
      throw blocked(
        'Remove event has a missing or malformed createdAt',
        'MALFORMED_SOURCE_PAYLOAD',
      );
    return { sourceId, entity, action: 'remove', occurredAt: payload.createdAt };
  }
  const { classification } =
    entity === 'comments'
      ? await fetchComment(env, sourceId, { fetcher })
      : await fetchIssue(env, sourceId, { fetcher });
  const record = classifyHydration(classification, entity.slice(0, -1));
  // Guard against a mock/real API answering the wrong record for the query (a wrong-record
  // response would otherwise silently apply as if it were the requested entity).
  if (record.id !== sourceId)
    throw blocked(
      `Hydrated record id (${record.id}) does not match the requested source id (${sourceId})`,
      'SOURCE_ID_MISMATCH',
    );
  return { sourceId, entity, action: 'update', record };
}

// --- resolver: linear_source_map, both directions, loaded ONLY when actually needed ---

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

// Bootstraps from the ORIGINAL import-normalized baseline the first time (frozen
// linear_import_records payload), then from the REMOTE-normalized baseline on every
// subsequent pass (linear_source_map.local_snapshot, written by touchSourceMap with the
// mapped REMOTE fields — never the merge outcome; see touchSourceMap for why).
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

// --- staleness / no-op guards (reject stale deliveries; unchanged = zero writes) --------

function assertNotStale(mapping, rawRecord) {
  const incoming = rawRecord?.updatedAt ?? null;
  if (mapping.source_updated_at && incoming && Date.parse(incoming) < Date.parse(mapping.source_updated_at))
    // Plausibly replica lag / clock skew, not a poisoned payload: retry with backoff
    // instead of getting stuck in a terminal state waiting on an admin.
    throw transient('Delivery is older than the already-applied source state', 'STALE_DELIVERY');
}
function isUnchanged(mapping, rawRecord) {
  return Boolean(mapping.payload_hash) && mapping.payload_hash === digest(rawRecord);
}

// --- persistence helpers ---------------------------------------------------------------

// Stores a REMOTE-NORMALIZED baseline (`remoteMappedFields`), never the merge outcome —
// otherwise a locally-kept value during a conflict gets adopted as the new baseline and a
// later delivery repeating the SAME remote change looks like "remote changed the field
// again", silently overwriting the local value it was supposed to protect.
async function touchSourceMap(
  tx,
  ctx,
  collection,
  sourceId,
  targetId_,
  remoteMappedFields,
  rawRecord,
) {
  await tx.exec(
    `INSERT INTO linear_source_map(workspace_id,source_workspace_id,collection,source_id,target_id,payload_hash,import_id,local_snapshot,source_deleted_at,source_updated_at,synced_at)
     VALUES(?,?,?,?,?,?,?,?,NULL,?,?)
     ON CONFLICT(workspace_id,source_workspace_id,collection,source_id)
     DO UPDATE SET target_id=excluded.target_id,payload_hash=excluded.payload_hash,local_snapshot=excluded.local_snapshot,source_deleted_at=NULL,source_updated_at=excluded.source_updated_at,synced_at=excluded.synced_at`,
    [
      ctx.actor.workspace_id,
      ctx.completedImport.source_workspace_id,
      collection,
      sourceId,
      targetId_,
      digest(rawRecord),
      ctx.completedImport.id,
      JSON.stringify(remoteMappedFields),
      rawRecord?.updatedAt ?? null,
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

// --- removal / restore lifecycle --------------------------------------------------------

// A stale/duplicate remove -- at-or-before the currently active removed-marker (already
// applied, a replay or a late-arriving duplicate delivery) OR at-or-before the last
// applied active state (a newer state was already synced since this remove occurred) --
// is a silent, idempotent no-op: never an error, never re-applied, never something an
// admin needs to retry.
function isStaleRemove(mapping, occurredAt) {
  if (mapping.source_deleted_at)
    return Date.parse(occurredAt) <= Date.parse(mapping.source_deleted_at);
  if (mapping.source_updated_at)
    return Date.parse(occurredAt) <= Date.parse(mapping.source_updated_at);
  return false;
}
function commentRowToMergeFields(current) {
  return { body: current.body, author_source_id: current.author_source_id };
}
// null baseline (never synced, or the frozen import record was itself blocked) means there
// is nothing to compare local content against -- native content is still always retained
// either way, but this specific divergence check has nothing to say; documented as a known
// visibility gap in docs/LINEAR-SYNC.md, not a silent bug.
function hasDiverged(baseline, local, trackedFields) {
  if (!baseline) return false;
  return trackedFields.some(
    (f) => JSON.stringify(local?.[f] ?? null) !== JSON.stringify(baseline?.[f] ?? null),
  );
}
async function loadLocalStateForRemoval(tx, ctx, collection, targetId_) {
  if (collection === 'issues') {
    const { current, currentLabelIds } = await loadIssueContext(tx, ctx, targetId_);
    return {
      issueId: targetId_,
      fields: issueRowToMergeFields(current, currentLabelIds),
      trackedFields: ISSUE_MERGE_FIELDS,
    };
  }
  const current = await tx.one('SELECT * FROM comments WHERE workspace_id=? AND id=?', [
    ctx.actor.workspace_id,
    targetId_,
  ]);
  if (!current) throw blocked('Mapped comment row no longer exists', 'MISSING_TARGET');
  return {
    issueId: current.issue_id,
    fields: commentRowToMergeFields(current),
    trackedFields: COMMENT_MERGE_FIELDS,
  };
}
// Verified source deletion for an entity NEVER imported/mapped: linear_source_map.target_id
// is NOT NULL (migration 0005), so an unmapped remove cannot use that table at all -- record
// a durable, inspectable receipt instead. Never fabricates a native row just to have
// somewhere to put the receipt. Idempotent: a later, earlier-occurring duplicate never
// regresses the recorded removed_at/delivery_id.
async function recordRemovalReceipt(tx, ctx, collection, sourceId, occurredAt) {
  const previous = await tx.one('SELECT removed_at FROM linear_removal_receipts WHERE workspace_id=? AND source_workspace_id=? AND collection=? AND source_id=?', [ctx.actor.workspace_id, ctx.completedImport.source_workspace_id, collection, sourceId]);
  if (previous && Date.parse(previous.removed_at) >= Date.parse(occurredAt)) return;
  occurredAt = new Date(occurredAt).toISOString();
  await tx.exec(
    `INSERT INTO linear_removal_receipts(id,workspace_id,source_workspace_id,collection,source_id,removed_at,delivery_id,created_at)
     VALUES(?,?,?,?,?,?,?,?)
     ON CONFLICT(workspace_id,source_workspace_id,collection,source_id) DO UPDATE SET
       removed_at=excluded.removed_at,
       delivery_id=excluded.delivery_id`,
    [
      id(),
      ctx.actor.workspace_id,
      ctx.completedImport.source_workspace_id,
      collection,
      sourceId,
      occurredAt,
      ctx.deliveryId,
      now(),
    ],
  );
}
// Applies a verified Issue:remove/Comment:remove delivery. Never touches issue/comment
// content: sets the marker (or, for an unmapped source id, a receipt) and, if local
// content had diverged from the last synced baseline at the moment this remove arrived,
// records a sticky conflict for visibility -- native content is retained regardless of
// resolution either way.
async function applyRemove(tx, ctx, hydrated, mapping) {
  const { sourceId, entity: collection, occurredAt } = hydrated;
  if (!mapping) return recordRemovalReceipt(tx, ctx, collection, sourceId, occurredAt);
  let effectiveMapping = mapping;
  if (!mapping.source_updated_at) {
    const frozen = await tx.one(
      'SELECT payload FROM linear_import_records WHERE workspace_id=? AND import_id=? AND collection=? AND source_id=?',
      [ctx.actor.workspace_id, mapping.import_id, collection, sourceId],
    );
    const updatedAt = frozen ? JSON.parse(frozen.payload).updatedAt : null;
    if (updatedAt && Number.isFinite(Date.parse(updatedAt)))
      effectiveMapping = { ...mapping, source_updated_at: updatedAt };
  }
  if (isStaleRemove(effectiveMapping, occurredAt)) return; // idempotent no-op
  const targetId_ = mapping.target_id;
  const {
    issueId,
    fields: local,
    trackedFields,
  } = await loadLocalStateForRemoval(tx, ctx, collection, targetId_);
  const mapFn = collection === 'issues' ? mapIssue : mapComment;
  const baseline = await loadBaseline(tx, ctx, collection, sourceId, mapping, mapFn);
  const diverged = hasDiverged(baseline, local, trackedFields);
  await tx.exec(
    'UPDATE linear_source_map SET source_deleted_at=?,last_removed_at=?,restored_at=NULL,synced_at=? WHERE workspace_id=? AND source_workspace_id=? AND collection=? AND source_id=?',
    [
      occurredAt,
      occurredAt,
      now(),
      ctx.actor.workspace_id,
      ctx.completedImport.source_workspace_id,
      collection,
      sourceId,
    ],
  );
  if (diverged)
    await recordConflicts(tx, ctx, collection, sourceId, targetId_, [
      {
        field: '__source_removed__',
        baseline_value: null,
        local_value: 'local content diverged from the last synced baseline',
        remote_value: occurredAt,
      },
    ]);
  await insertActivity(
    tx,
    ctx,
    issueId,
    diverged ? { sourceRemoved: true, sourceRemovalConflict: true } : { sourceRemoved: true },
  );
}
// A later UPDATE whose own `updatedAt` is newer than the currently-recorded removal is the
// ONLY restore signal Linear sends -- there is no separate "restore" webhook event, a plain
// update on a previously-removed item IS the restore. Older-or-equal must NEVER clear the
// marker: that would either resurrect an item a genuinely later remove already re-applied,
// or replay a stale update that raced the removal.
async function handleImplicitRestore(tx, ctx, collection, sourceId, mapping, incomingUpdatedAt) {
  if (!mapping.source_deleted_at) return 'not-removed';
  if (Date.parse(incomingUpdatedAt) <= Date.parse(mapping.source_deleted_at)) return 'stale';
  await tx.exec(
    'UPDATE linear_source_map SET source_deleted_at=NULL,restored_at=?,synced_at=? WHERE workspace_id=? AND source_workspace_id=? AND collection=? AND source_id=?',
    [
      incomingUpdatedAt,
      now(),
      ctx.actor.workspace_id,
      ctx.completedImport.source_workspace_id,
      collection,
      sourceId,
    ],
  );
  mapping.source_deleted_at = null; // keep the in-memory row consistent for the rest of this call
  return 'restored';
}

// --- issue change description: records only the ACTUALLY-APPLIED values (`result`/final
// assignee), never the raw remote record — otherwise a conflict where remote lost still
// generates a false "changed" history entry (source ids, matching activity.mjs's resolver
// contract). --------------------------------------------------------------------------

function issueChangeData(ctx, current, currentLabelIds, result, finalAssigneeSourceId) {
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
      ctx.reverseRef('workflowStates', result.status_id),
    );
    pair(
      'AssigneeId',
      ctx.reverseRef('users', current.assignee_source_id),
      ctx.reverseRef('users', finalAssigneeSourceId),
    );
    pair('Priority', current.priority, result.priority);
    pair('Title', current.title, result.title);
    pair(
      'ProjectId',
      ctx.reverseRef('projects', current.project_id),
      ctx.reverseRef('projects', result.project_id),
    );
    pair(
      'CycleId',
      ctx.reverseRef('cycles', current.cycle_id),
      ctx.reverseRef('cycles', result.cycle_id),
    );
    pair(
      'ProjectMilestoneId',
      ctx.reverseRef('projectMilestones', current.milestone_id),
      ctx.reverseRef('projectMilestones', result.milestone_id),
    );
    pair(
      'ParentId',
      ctx.reverseRef('issues', current.parent_id),
      ctx.reverseRef('issues', result.parent_id),
    );
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
    // Sorted so the 3-way compare treats label SETS as the value, not label ORDER — an
    // unordered `SELECT` returning the same members in a different order than the
    // (also sorted) baseline/remote must never manufacture a false conflict that then
    // silently drops a real remote add/remove.
    label_ids: [...labelIds].sort((a, b) => a.localeCompare(b)),
  };
}
function issueCandidate(
  targetId_,
  teamId,
  result,
  { assigneeInput = null, startDate = null } = {},
) {
  return {
    id: targetId_,
    team_id: teamId,
    status_id: result.status_id,
    assignee_id: assigneeInput,
    project_id: result.project_id,
    cycle_id: result.cycle_id,
    milestone_id: result.milestone_id,
    parent_id: result.parent_id,
    start_date: startDate,
    due_date: result.due_date,
  };
}
// Real native member assignment (issues.assignee_id -> memberships) is a SEPARATE,
// mutually-exclusive mechanism from the Linear-mapped assignee (assignee_source_id ->
// source_people); see packages/server/core/source-people.mjs. The sync only ever knows
// about the source_people side. An unrelated remote change (assignee_source_id unchanged
// by the merge) must never touch a real member's assignment; only a GENUINE change to the
// merged assignee_source_id may clear it, since the two are mutually exclusive by the
// app's own convention (packages/server/modules/tickets/service.mjs's updateIssue clears
// the other side whenever one is set).
function candidateAssigneeInput(current, result) {
  return result.assignee_source_id === current.assignee_source_id
    ? (current.assignee_id ?? current.assignee_source_id)
    : result.assignee_source_id;
}
async function loadIssueContext(tx, ctx, targetId_) {
  const current = await tx.one('SELECT * FROM issues WHERE workspace_id=? AND id=?', [
    ctx.actor.workspace_id,
    targetId_,
  ]);
  if (!current) throw blocked('Mapped issue row no longer exists', 'MISSING_TARGET');
  const currentLabelIds = (
    await tx.all('SELECT label_id FROM issue_labels WHERE workspace_id=? AND issue_id=?', [
      ctx.actor.workspace_id,
      targetId_,
    ])
  )
    .map((r) => r.label_id)
    .sort();
  return { current, currentLabelIds };
}
async function issueUpdateValues(tx, ctx, current, result) {
  const assigneeInput = candidateAssigneeInput(current, result);
  const candidate = issueCandidate(current.id, current.team_id, result, {
    assigneeInput,
    startDate: current.start_date,
  });
  await validateReferences(tx, ctx.actor, candidate, result.label_ids);
  return {
    ...result,
    assignee_id: candidate.assignee_id,
    assignee_source_id: candidate.assignee_source_id,
  };
}
// team_id/number/key/created_at are identity fields (see map.mjs). A team change on
// Linear's side can invalidate team-scoped status_id/project_id — atomically re-validating
// those together with a team swap is out of scope for this pass, and silently ignoring
// the team change would leave the row's team desynced from Linear forever. Blocked
// explicitly instead, so the operator sees WHY nothing applied.
function assertNoTeamReassignment(current, remoteFields) {
  if (remoteFields.team_id !== current.team_id)
    throw blocked(
      'Issue team reassignment via sync is unsupported in this pass',
      'TEAM_REASSIGNMENT_UNSUPPORTED',
    );
}
async function applyIssueUpdate(
  tx,
  ctx,
  hydrated,
  mapping,
  remoteFields,
  rawRecord,
  restored = false,
) {
  const targetId_ = mapping.target_id;
  const { current, currentLabelIds } = await loadIssueContext(tx, ctx, targetId_);
  assertNoTeamReassignment(current, remoteFields);
  const baseline = await loadBaseline(tx, ctx, 'issues', hydrated.sourceId, mapping, mapIssue);
  const local = issueRowToMergeFields(current, currentLabelIds);
  const { result, conflicts } = mergeFields(baseline, local, remoteFields, ISSUE_MERGE_FIELDS);
  const values = await issueUpdateValues(tx, ctx, current, result);
  // deleted_at is NEVER written from sync (see applyIssueDelivery's SOURCE_TRASHED_
  // UNSUPPORTED guard, which runs before this function is even reached) — native
  // soft-delete state, local or otherwise, is always left exactly as it was.
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
  ];
  const update = await tx.exec(
    `UPDATE issues SET ${columns.map((c) => c + '=?').join(',')},version=version+1,updated_at=? WHERE workspace_id=? AND id=? AND version=?`,
    [...columns.map((c) => values[c]), now(), ctx.actor.workspace_id, targetId_, current.version],
  );
  if (Number(update.changes) !== 1)
    // A normal concurrent-edit collision, not a poisoned payload: retry with backoff.
    throw transient('Concurrent local edit raced the sync write', 'VERSION_RACE');
  await replaceLabels(tx, ctx.actor, targetId_, result.label_ids);
  await recordConflicts(tx, ctx, 'issues', hydrated.sourceId, targetId_, conflicts);
  const changeData = issueChangeData(
    ctx,
    current,
    currentLabelIds,
    result,
    values.assignee_source_id,
  );
  // A separate activity entry from the field-change one above: "restored" and "these
  // fields changed" are two distinct facts about the same delivery, not one merged event.
  if (restored) await insertActivity(tx, ctx, targetId_, { sourceRestored: true });
  await insertActivity(tx, ctx, targetId_, changeData);
  await touchSourceMap(tx, ctx, 'issues', hydrated.sourceId, targetId_, remoteFields, rawRecord);
}
function newIssueRow(ctx, targetIssueId, fields, assigneeInput) {
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
    assignee_id: assigneeInput === fields.assignee_source_id ? null : assigneeInput,
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
    // A pre-trashed source issue never reaches here at all (applyIssueDelivery blocks it
    // before create/update); a freshly-created native row is never pre-deleted.
    deleted_at: null,
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
      hydrated.record.url ?? `https://linear.app/issue/${hydrated.record.identifier}`,
      hydrated.record.identifier,
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
  await tx.lock(ctx.actor.workspace_id);
  const existing = await tx.one(
    'SELECT id FROM issues WHERE workspace_id=? AND team_id=? AND (number=? OR key=?)',
    [ctx.actor.workspace_id, fields.team_id, fields.number, fields.key],
  );
  if (existing?.id === targetIssueId)
    throw blocked('Existing deterministic issue has no source mapping', 'ALREADY_EXISTS_UNMAPPED');
  let nativeFields = fields;
  if (existing) {
    const team = await tx.one('SELECT key,next_number FROM teams WHERE workspace_id=? AND id=?', [
      ctx.actor.workspace_id,
      fields.team_id,
    ]);
    const maximum = await tx.one(
      'SELECT MAX(number) AS value FROM issues WHERE workspace_id=? AND team_id=?',
      [ctx.actor.workspace_id, fields.team_id],
    );
    if (!team) throw blocked('Source team mapping is unavailable', 'MISSING_REFERENCE');
    const number = Math.max(Number(team.next_number), Number(maximum.value ?? 0) + 1);
    if (!Number.isSafeInteger(number) || number < 1)
      throw blocked('Invalid native issue sequence', 'INVALID_SEQUENCE');
    nativeFields = { ...fields, number, key: team.key + '-' + number };
  }
  const candidate = issueCandidate(targetIssueId, fields.team_id, fields, {
    assigneeInput: fields.assignee_source_id,
  });
  await validateReferences(tx, ctx.actor, candidate, fields.label_ids);
  const row = newIssueRow(ctx, targetIssueId, nativeFields, candidate.assignee_id);
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
  await linkAndBumpTeamNumber(tx, ctx, hydrated, nativeFields, targetIssueId);
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
}
// `mapping` (the entity's OWN linear_source_map row, or null if never synced before) is
// passed in already-fetched by applyInboxRow — this function never re-queries it, so a
// confirmed no-op delivery (checked by the caller BEFORE ctx/resolveRef even exist) skips
// the full-map `loadResolvers` load entirely instead of paying for it on every delivery.
async function applyIssueDelivery(tx, ctx, hydrated, mapping) {
  const mapped = mapIssue(hydrated.record, ctx.resolveRef);
  throwIfMapBlocked(mapped);
  // Conservative safety guard, NOT deletion support: a source issue currently reported as
  // trashed is blocked whole (no partial write of its other fields), never soft-deleted.
  // Real removal semantics are explicit future work (see docs/LINEAR-SYNC.md).
  if (mapped.fields.trashed)
    throw blocked(
      'Source issue is trashed in Linear; trash/deletion sync is unsupported in this pass',
      'SOURCE_TRASHED_UNSUPPORTED',
    );
  let restored = false;
  if (mapping) {
    const outcome = await handleImplicitRestore(
      tx,
      ctx,
      'issues',
      hydrated.sourceId,
      mapping,
      mapped.fields.updated_at,
    );
    if (outcome === 'stale') return; // stale update while removed: no-op, must not resurrect
    restored = outcome === 'restored';
  }
  if (mapping)
    await applyIssueUpdate(tx, ctx, hydrated, mapping, mapped.fields, hydrated.record, restored);
  else await applyIssueCreate(tx, ctx, hydrated, mapped.fields);
}

// --- comment apply -----------------------------------------------------------------------

async function applyCommentUpdate(
  tx,
  ctx,
  hydrated,
  mapping,
  remoteFields,
  rawRecord,
  restored = false,
) {
  const current = await tx.one('SELECT * FROM comments WHERE workspace_id=? AND id=?', [
    ctx.actor.workspace_id,
    mapping.target_id,
  ]);
  if (!current) throw blocked('Mapped comment row no longer exists', 'MISSING_TARGET');
  const baseline = await loadBaseline(tx, ctx, 'comments', hydrated.sourceId, mapping, mapComment);
  const local = commentRowToMergeFields(current);
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
    throw transient('Concurrent local edit raced the sync write', 'VERSION_RACE');
  await recordConflicts(tx, ctx, 'comments', hydrated.sourceId, mapping.target_id, conflicts);
  if (restored) await insertActivity(tx, ctx, current.issue_id, { sourceRestored: true });
  await insertActivity(tx, ctx, current.issue_id, { commented: true });
  await touchSourceMap(
    tx,
    ctx,
    'comments',
    hydrated.sourceId,
    mapping.target_id,
    remoteFields,
    rawRecord,
  );
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
}
// Same no-op-skips-loadResolvers contract as applyIssueDelivery.
async function applyCommentDelivery(tx, ctx, hydrated, mapping) {
  const mapped = mapComment(hydrated.record, ctx.resolveRef);
  throwIfMapBlocked(mapped);
  let restored = false;
  if (mapping) {
    const outcome = await handleImplicitRestore(
      tx,
      ctx,
      'comments',
      hydrated.sourceId,
      mapping,
      mapped.fields.updated_at,
    );
    if (outcome === 'stale') return; // stale update while removed: no-op, must not resurrect
    restored = outcome === 'restored';
  }
  if (mapping)
    await applyCommentUpdate(tx, ctx, hydrated, mapping, mapped.fields, hydrated.record, restored);
  else await applyCommentCreate(tx, ctx, hydrated, mapped.fields);
}

// --- orchestration: pinning, fencing, transaction boundary --------------------------------

// Confirms the module is enabled, the canonical (live-fetched) organization matches the
// imported workspace's recorded organization, AND the acting importer is still a current,
// authorized member of the workspace — an importer whose membership was later revoked can
// no longer drive writes. Throws (never returns a value) so the caller's transaction rolls
// back cleanly and a SEPARATE transaction (recordFailure) marks the inbox row.
async function assertAuthorizedToApply(tx, workspace, completedImport, job, canonicalOrgId) {
  const moduleRow = await tx.one(
    "SELECT enabled FROM module_settings WHERE workspace_id=? AND module='linear-sync'",
    [workspace],
  );
  if (moduleRow?.enabled === 0) throw blocked('linear-sync module is disabled', 'MODULE_DISABLED');
  if (
    !completedImport ||
    completedImport.source_workspace_id !== job.organization_id ||
    completedImport.source_workspace_id !== canonicalOrgId
  )
    throw blocked(
      'Webhook organization does not match the live canonical organization',
      'ORG_MISMATCH',
    );
  const authorizedActor = await tx.one(
    'SELECT user_id FROM memberships WHERE workspace_id=? AND user_id=?',
    [workspace, completedImport.created_by],
  );
  if (!authorizedActor)
    throw blocked(
      'The importer is no longer an authorized member of this workspace',
      'ACTOR_NOT_AUTHORIZED',
    );
}
// `resolverCache` is a mutable `{ current: null }` box owned by ONE runLinearSyncWorker
// call, reused across every delivery in that bounded run instead of reloaded per delivery
// (round-3 finding 8 only fixed the no-op case; a genuinely changed delivery still paid
// the full unfiltered linear_source_map scan on every single call). Loaded lazily, once,
// on the first delivery that actually needs it. Trade-off, accepted deliberately: a
// mapping created by an EARLIER delivery within this SAME run (e.g. a brand-new parent
// issue) won't be visible to a LATER delivery in the same run via this cache — that later
// delivery blocks MISSING_REFERENCE and self-heals on the next worker invocation, which
// starts a fresh cache. This is a bounded, self-correcting staleness window, not a
// permanent one; a cross-run cache would not be safe.
async function buildDeliveryContext(tx, job, webhookPayload, completedImport, resolverCache) {
  const workspace = job.workspace_id;
  resolverCache.current ??= await loadResolvers(tx, workspace, completedImport.source_workspace_id);
  const { resolveRef, reverseRef } = resolverCache.current;
  const actor = { id: completedImport.created_by, workspace_id: workspace };
  const actorSourceId = webhookPayload?.actor?.id
    ? resolveRef('users', webhookPayload.actor.id)
    : null;
  return {
    actor,
    completedImport,
    resolveRef,
    reverseRef,
    deliveryId: job.delivery_id,
    actorSourceId,
  };
}
async function markInboxDone(tx, job) {
  const update = await tx.exec(
    "UPDATE linear_webhook_inbox SET status='done',last_error=NULL WHERE id=? AND claim_token=?",
    [job.id, job.claim_token],
  );
  return { skipped: Number(update.changes) !== 1 };
}
// Claim fencing: re-checks status AND claim_token under the SAME lock key claimNextInboxRow
// used (see workerLockKey) before any write. An expired worker whose lease was already
// reclaimed by someone else can never overwrite a newer claim or reset a completed job.
async function applyInboxRow(tx, job, hydrated, webhookPayload, canonicalOrgId, resolverCache) {
  const workspace = job.workspace_id;
  await tx.lock(workerLockKey(workspace));
  const live = await tx.one('SELECT status,claim_token FROM linear_webhook_inbox WHERE id=?', [
    job.id,
  ]);
  if (live?.status !== 'processing' || live.claim_token !== job.claim_token)
    return { skipped: true };
  const completedImport = await tx.one(
    "SELECT id,source_workspace_id,created_by FROM linear_imports WHERE workspace_id=? AND status='completed' ORDER BY completed_at DESC LIMIT 1",
    [workspace],
  );
  await assertAuthorizedToApply(tx, workspace, completedImport, job, canonicalOrgId);
  const collection = hydrated.entity;
  const mapping = await tx.one(
    'SELECT target_id,local_snapshot,import_id,payload_hash,source_updated_at,source_deleted_at FROM linear_source_map WHERE workspace_id=? AND source_workspace_id=? AND collection=? AND source_id=?',
    [workspace, completedImport.source_workspace_id, collection, hydrated.sourceId],
  );
  if (hydrated.action === 'remove') {
    // A remove has no `hydrated.record` to compare via assertNotStale/isUnchanged (those
    // only make sense for a hydrated update payload) -- chronology safety for a remove is
    // entirely inside applyRemove (isStaleRemove), keyed off the event's own createdAt.
    const ctx = await buildDeliveryContext(tx, job, webhookPayload, completedImport, resolverCache);
    await applyRemove(tx, ctx, hydrated, mapping);
    return markInboxDone(tx, job);
  }
  if (mapping) {
    assertNotStale(mapping, hydrated.record);
    // Confirmed no-op: never load the full source map (loadResolvers), never touch
    // anything else — just mark the row done and return. A removed-then-not-yet-restored
    // mapping is NEVER a confirmed no-op even if the hash happens to match a stale cached
    // payload: applyIssueDelivery/applyCommentDelivery's restore check must still run.
    if (!mapping.source_deleted_at && isUnchanged(mapping, hydrated.record))
      return markInboxDone(tx, job);
  }
  if (!mapping) {
    const removed = await tx.one(
      'SELECT removed_at FROM linear_removal_receipts WHERE workspace_id=? AND source_workspace_id=? AND collection=? AND source_id=?',
      [workspace, completedImport.source_workspace_id, collection, hydrated.sourceId],
    );
    if (removed && Date.parse(hydrated.record.updatedAt) <= Date.parse(removed.removed_at))
      return markInboxDone(tx, job);
  }
  const ctx = await buildDeliveryContext(tx, job, webhookPayload, completedImport, resolverCache);
  if (collection === 'issues') await applyIssueDelivery(tx, ctx, hydrated, mapping);
  else await applyCommentDelivery(tx, ctx, hydrated, mapping);
  return markInboxDone(tx, job);
}
async function claimNextInboxRow(db, env) {
  if (!env.LINEAR_SYNC_WORKSPACE_ID) return null;
  return db.transaction(async (tx) => {
    await tx.lock(workerLockKey(env.LINEAR_SYNC_WORKSPACE_ID));
    const row = await tx.one(
      "SELECT * FROM linear_webhook_inbox WHERE workspace_id=? AND status IN ('pending','processing') AND next_attempt_at<=? ORDER BY created_at,id LIMIT 1",
      [env.LINEAR_SYNC_WORKSPACE_ID, now()],
    );
    if (!row) return null;
    const claimToken = id();
    await tx.exec(
      "UPDATE linear_webhook_inbox SET status='processing',attempts=attempts+1,next_attempt_at=?,claim_token=? WHERE id=?",
      [new Date(Date.now() + 60000).toISOString(), claimToken, row.id],
    );
    return { ...row, attempts: row.attempts + 1, claim_token: claimToken };
  });
}
// Fenced the same way as the success path, under the SAME lock key: an expired/superseded
// claim must never write over a newer claim's state.
async function recordFailure(db, job, error) {
  const signal = error instanceof SyncSignal ? error : null;
  const isBlocked = signal?.kind === 'blocked';
  const nextDelayMs = signal?.retryAfterMs ?? Math.min(3600, 2 ** job.attempts * 15) * 1000;
  await db.transaction(async (tx) => {
    await tx.lock(workerLockKey(job.workspace_id));
    const live = await tx.one('SELECT status,claim_token FROM linear_webhook_inbox WHERE id=?', [
      job.id,
    ]);
    if (!live || live.claim_token !== job.claim_token) return;
    await tx.exec(
      'UPDATE linear_webhook_inbox SET status=?,next_attempt_at=?,last_error=? WHERE id=? AND claim_token=?',
      [
        isBlocked ? 'blocked' : job.attempts >= 8 ? 'failed' : 'pending',
        new Date(Date.now() + nextDelayMs).toISOString(),
        signal?.code ?? signal?.kind ?? error?.code ?? 'SYNC_FAILED',
        job.id,
        job.claim_token,
      ],
    );
  });
  return isBlocked;
}
export async function runLinearSyncWorker(
  db,
  env,
  { limit = 10, fetcher = fetch, deadlineMs = Infinity } = {},
) {
  const results = { processed: 0, blocked: 0, failed: 0 };
  if (!env.LINEAR_SYNC_WORKSPACE_ID) return results;
  let canonicalOrgId = null;
  const resolverCache = { current: null };
  for (let n = 0; n < limit && Date.now() < deadlineMs; n++) {
    const job = await claimNextInboxRow(db, env);
    if (!job) break;
    try {
      canonicalOrgId ??= await resolveCanonicalOrganizationId(env, fetcher);
      const webhookPayload = JSON.parse(job.payload);
      const hydrated = await hydrateEntity(env, job, fetcher);
      const outcome = await db.transaction((tx) =>
        applyInboxRow(tx, job, hydrated, webhookPayload, canonicalOrgId, resolverCache),
      );
      if (!outcome?.skipped) results.processed++;
    } catch (error) {
      const wasBlocked = await recordFailure(db, job, error);
      if (wasBlocked) results.blocked++;
      else results.failed++;
    }
  }
  return results;
}
