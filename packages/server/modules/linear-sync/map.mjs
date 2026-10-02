// Single-entity field mappers, mirroring packages/imports/linear-projection.mjs's field
// mapping for issues/comments exactly (same table/column names, same enum values) but
// operating on one hydrated (or baseline) source record at a time instead of a full
// in-memory snapshot. Used for BOTH sides of a 3-way merge: the baseline (derived from a
// frozen linear_import_records payload) and the remote (a freshly hydrated payload) go
// through the same mapper here.

// Fields the sync worker keeps in sync (3-way merged). team_id/number/key/created_at are
// identity fields, applied as-is on create and left alone on update in this pass.
export const ISSUE_MERGE_FIELDS = Object.freeze([
  'title',
  'description',
  'status_id',
  'priority',
  'assignee_source_id',
  'project_id',
  'cycle_id',
  'milestone_id',
  'parent_id',
  'estimate',
  'due_date',
  'position',
  'archived_at',
  'trashed',
  'label_ids',
]);
export const COMMENT_MERGE_FIELDS = Object.freeze(['body', 'author_source_id']);

const refId = (value) => (value == null ? null : typeof value === 'string' ? value : value.id);

/**
 * @param {object} record a Linear `issues` source record (either from a frozen
 *   linear_import_records payload, or a freshly hydrated GraphQL response shaped the same way).
 * @param {(collection: string, sourceId: string) => (string|null)} resolveRef looks up
 *   `linear_source_map`; returns null when unmapped (never throws, never mints new mappings).
 */
export function mapIssue(record, resolveRef) {
  const refSpecs = [
    ['team_id', 'teams', record.team],
    ['status_id', 'workflowStates', record.state],
    ['assignee_source_id', 'users', record.assignee],
    ['creator_source_id', 'users', record.creator],
    ['project_id', 'projects', record.project],
    ['cycle_id', 'cycles', record.cycle],
    ['milestone_id', 'projectMilestones', record.projectMilestone],
    ['parent_id', 'issues', record.parent],
  ];
  const missing = [];
  const resolved = {};
  for (const [field, collection, raw] of refSpecs) {
    const sourceId = refId(raw);
    if (sourceId == null) {
      resolved[field] = null;
      continue;
    }
    const target = resolveRef(collection, sourceId);
    if (target == null) missing.push(field);
    resolved[field] = target;
  }
  const labelIds = [];
  for (const sourceId of record.labelIds ?? []) {
    const target = resolveRef('issueLabels', sourceId);
    if (target == null) missing.push('label:' + sourceId);
    else labelIds.push(target);
  }
  if (missing.length) return { blocked: true, missing };
  return {
    blocked: false,
    fields: {
      team_id: resolved.team_id,
      status_id: resolved.status_id,
      title: String(record.title ?? '').slice(0, 300),
      description: record.description ?? '',
      priority: Number.isInteger(record.priority) ? record.priority : 0,
      assignee_source_id: resolved.assignee_source_id,
      creator_source_id: resolved.creator_source_id,
      project_id: resolved.project_id,
      cycle_id: resolved.cycle_id,
      milestone_id: resolved.milestone_id,
      parent_id: resolved.parent_id,
      estimate: record.estimate ?? null,
      due_date: record.dueDate ?? null,
      position: record.sortOrder ?? record.number ?? 0,
      archived_at: record.archivedAt ?? null,
      trashed: Boolean(record.trashed),
      label_ids: labelIds,
      number: record.number,
      key: record.identifier,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    },
  };
}

/** @param {object} record a Linear `comments` source record. */
export function mapComment(record, resolveRef) {
  const issueSourceId = refId(record.issueId != null ? record.issueId : record.issue);
  const userSourceId = refId(record.user);
  const missing = [];
  const issue_id = issueSourceId == null ? null : resolveRef('issues', issueSourceId);
  if (issueSourceId != null && issue_id == null) missing.push('issue_id');
  const author_source_id = userSourceId == null ? null : resolveRef('users', userSourceId);
  if (userSourceId != null && author_source_id == null) missing.push('author_source_id');
  if (missing.length) return { blocked: true, missing };
  return {
    blocked: false,
    fields: {
      issue_id,
      author_source_id,
      body: record.body ?? '',
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    },
  };
}
