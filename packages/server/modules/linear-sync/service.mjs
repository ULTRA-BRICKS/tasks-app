// Owner/admin-only status, conflict and retry surface over the sync inbox/conflicts tables.
import { now } from '../../core/crypto.mjs';
import { assert, missing, requirePermission } from '../../core/errors.mjs';

export async function linearSyncStatus(tx, actor) {
  requirePermission(actor, 'admin');
  const workspace = actor.workspace_id;
  const counts = await tx.all(
    'SELECT status,COUNT(*) AS count FROM linear_webhook_inbox WHERE workspace_id=? GROUP BY status',
    [workspace],
  );
  const oldestPending = await tx.one(
    "SELECT created_at FROM linear_webhook_inbox WHERE workspace_id=? AND status='pending' ORDER BY created_at LIMIT 1",
    [workspace],
  );
  const openConflicts = await tx.one(
    'SELECT COUNT(*) AS n FROM linear_sync_conflicts WHERE workspace_id=? AND resolved_at IS NULL',
    [workspace],
  );
  const cursors = await tx.all(
    'SELECT collection,cursor IS NOT NULL AS in_progress,last_synced_at,status FROM linear_sync_cursors WHERE workspace_id=?',
    [workspace],
  );
  const completedImport = await tx.one(
    "SELECT source_workspace_id FROM linear_imports WHERE workspace_id=? AND status='completed' ORDER BY completed_at DESC LIMIT 1",
    [workspace],
  );
  return {
    counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.count)])),
    oldest_pending_age_seconds: oldestPending
      ? Math.max(0, Math.round((Date.now() - Date.parse(oldestPending.created_at)) / 1000))
      : null,
    open_conflicts: Number(openConflicts.n),
    cursors,
    has_completed_import: Boolean(completedImport),
  };
}
export async function listLinearSyncConflicts(tx, actor, { resolved = false } = {}) {
  requirePermission(actor, 'admin');
  return tx.all(
    `SELECT * FROM linear_sync_conflicts WHERE workspace_id=? AND resolved_at IS ${resolved ? 'NOT NULL' : 'NULL'} ORDER BY detected_at DESC LIMIT 200`,
    [actor.workspace_id],
  );
}
// Only plain scalar columns with no cross-column semantics are safe to write directly
// here. `label_ids` and `trashed` are tracked merge fields but are NOT real columns on
// `issues` (labels live in issue_labels; soft-delete lives in deleted_at) — writing them
// would throw a SQL error. `assignee_source_id` is deliberately excluded too: applying it
// correctly requires the same native-member/source-person mutual-exclusion resolution the
// sync worker performs (see worker.mjs's resolvedAssignee), which this endpoint does not
// replicate; resolving that field here is explicitly unsupported for now rather than
// silently writing a half-correct value.
const RESOLVABLE_COLUMNS = {
  issues: new Set([
    'title',
    'description',
    'status_id',
    'priority',
    'project_id',
    'cycle_id',
    'milestone_id',
    'parent_id',
    'estimate',
    'due_date',
    'position',
    'archived_at',
  ]),
  comments: new Set(['body']),
};

function assertResolvable(table, field) {
  assert(
    RESOLVABLE_COLUMNS[table]?.has(field),
    422,
    'UNSUPPORTED_RESOLUTION',
    `Conflicts on ${table}.${field} cannot be applied through this endpoint yet; keep local or resolve manually`,
  );
}
async function applyRemoteResolution(tx, actor, conflict, expectedVersion) {
  const table = conflict.collection === 'comments' ? 'comments' : 'issues';
  assertResolvable(table, conflict.field);
  assert(
    Number.isInteger(expectedVersion),
    422,
    'MISSING_EXPECTED_VERSION',
    'expected_version is required to apply a remote resolution',
  );
  const current = await tx.one(`SELECT version FROM ${table} WHERE workspace_id=? AND id=?`, [
    actor.workspace_id,
    conflict.target_id,
  ]);
  assert(current, 409, 'TARGET_MISSING', 'The affected row no longer exists');
  // The admin reviewed the conflict at `expectedVersion`. If the row has moved since —
  // another local edit landed between review and resolution — reject rather than silently
  // clobbering an edit the admin never saw.
  assert(
    current.version === expectedVersion,
    409,
    'VERSION_RACE',
    'The row changed since this conflict was reviewed; re-review before resolving',
  );
  const update = await tx.exec(
    `UPDATE ${table} SET ${conflict.field}=?,version=version+1,updated_at=? WHERE workspace_id=? AND id=? AND version=?`,
    [
      JSON.parse(conflict.remote_value),
      now(),
      actor.workspace_id,
      conflict.target_id,
      expectedVersion,
    ],
  );
  assert(
    Number(update.changes) === 1,
    409,
    'VERSION_RACE',
    'The row changed again before this could apply',
  );
}
export async function resolveLinearSyncConflict(
  tx,
  actor,
  conflictId,
  resolution,
  expectedVersion,
) {
  requirePermission(actor, 'admin');
  assert(
    ['kept_local', 'applied_remote'].includes(resolution),
    422,
    'INVALID_RESOLUTION',
    'Unknown resolution',
  );
  const conflict = await tx.one(
    'SELECT * FROM linear_sync_conflicts WHERE workspace_id=? AND id=?',
    [actor.workspace_id, conflictId],
  );
  if (!conflict) throw missing('Conflict');
  assert(
    !conflict.resolved_at,
    409,
    'CONFLICT_ALREADY_RESOLVED',
    'This conflict was already resolved',
  );
  if (resolution === 'applied_remote')
    await applyRemoteResolution(tx, actor, conflict, expectedVersion);
  await tx.exec(
    'UPDATE linear_sync_conflicts SET resolved_at=?,resolution=? WHERE workspace_id=? AND id=?',
    [now(), resolution, actor.workspace_id, conflictId],
  );
  return { ...conflict, resolved_at: now(), resolution };
}
export async function retryLinearSyncEvent(tx, actor, inboxId) {
  requirePermission(actor, 'admin');
  const row = await tx.one('SELECT * FROM linear_webhook_inbox WHERE workspace_id=? AND id=?', [
    actor.workspace_id,
    inboxId,
  ]);
  if (!row) throw missing('Sync event');
  assert(
    ['failed', 'blocked'].includes(row.status),
    409,
    'NOT_RETRYABLE',
    'Only failed or blocked events can be retried',
  );
  await tx.exec(
    "UPDATE linear_webhook_inbox SET status='pending',next_attempt_at=?,last_error=NULL WHERE workspace_id=? AND id=?",
    [now(), actor.workspace_id, inboxId],
  );
  return { id: inboxId, status: 'pending' };
}
