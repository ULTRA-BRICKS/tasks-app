import { uuid } from '../../../imports/linear-source.mjs';
// Single-entity field mappers, mirroring packages/imports/linear-projection.mjs's field
// mapping for issues/comments exactly (same table/column names, same enum values) but
// operating on one hydrated (or baseline) source record at a time instead of a full
// in-memory snapshot. Used for BOTH sides of a 3-way merge: the baseline (derived from a
// frozen linear_import_records payload) and the remote (a freshly hydrated payload) go
// through the same mapper here.
//
// Nullability below is verified against vendor/linear/schema.graphql (the pinned Linear
// GraphQL schema), not guessed: `id`, `identifier`, `number`, `title`, `team`, `state`,
// `labelIds`, `url`, `priority`, `createdAt`, `updatedAt` are all non-null on both `Issue`
// and `Comment` (per field) in that schema — Linear guarantees they're always present for
// a real record. `description`, `dueDate`, `estimate`, `assignee`, `creator`, `project`,
// `cycle`, `projectMilestone`, `parent`, `trashed`, `archivedAt` are genuinely nullable
// there, so defaulting them (`?? null`, `?? ''`) is correct, not a cover-up. A payload
// missing one of the MANDATORY fields is malformed — REJECTED (`blocked`), never silently
// defaulted/truncated into a fake row that misrepresents what Linear actually holds.

// Fields the sync worker keeps in sync (3-way merged). team_id/number/key/created_at are
// identity fields, applied as-is on create; a team change on UPDATE is explicitly blocked
// (see applyIssueUpdate's TEAM_REASSIGNMENT_UNSUPPORTED guard in worker.mjs) rather than
// silently ignored, since a team change can invalidate team-scoped status_id/project_id.
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
// Exported: worker.mjs reuses this exact check for a remove event's own `createdAt` (the
// occurrence timestamp every remove/restore chronology comparison keys off), so "what
// counts as a valid Linear timestamp" has exactly one definition in the module.
export const isValidDateString = (value) =>
  typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
// Same cap as the one-time import's own title validation (packages/imports/linear-
// projection.mjs's `text(issue.title, 'issue title', 300)`, which THROWS on an oversized
// title) and the normal REST API's IssueCreate/IssuePatch schema (packages/contracts/
// schemas.mjs, text(300,1)). Before this, the sync path was the only one with no cap at
// all — silently truncating an oversized title is exactly the "fake row" behavior this
// module rejects everywhere else, so an oversized title is malformed, not truncated.
const MAX_TITLE_LENGTH = 300;

function issueMalformedFields(record) {
  const malformed = [];
  if (!uuid(record.id)) malformed.push('id');
  if (typeof record.identifier !== 'string' || !/^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]*$/.test(record.identifier)) malformed.push('identifier');
  if (!Number.isSafeInteger(record.number) || record.number<1) malformed.push('number');
  if (typeof record.title !== 'string' || !record.title.trim() || record.title.length > MAX_TITLE_LENGTH)
    malformed.push('title');
  if (!Number.isInteger(record.priority) || record.priority<0 || record.priority>4) malformed.push('priority');
  if (!isValidDateString(record.createdAt)) malformed.push('createdAt');
  if (!isValidDateString(record.updatedAt)) malformed.push('updatedAt');
  return malformed;
}
function resolveIssueRefs(record, resolveRef) {
  // [field, collection, raw, mandatory] — team/state are non-null per schema, so an
  // ABSENT (not just unresolved) value is itself malformed input, not "unset".
  const refSpecs = [
    ['team_id', 'teams', record.team, true],
    ['status_id', 'workflowStates', record.state, true],
    ['assignee_source_id', 'users', record.assignee, false],
    ['creator_source_id', 'users', record.creator, false],
    ['project_id', 'projects', record.project, false],
    ['cycle_id', 'cycles', record.cycle, false],
    ['milestone_id', 'projectMilestones', record.projectMilestone, false],
    ['parent_id', 'issues', record.parent, false],
  ];
  const missing = [],
    malformed = [],
    resolved = {};
  for (const [field, collection, raw, mandatory] of refSpecs) {
    const sourceId = refId(raw);
    if (sourceId == null) {
      if (mandatory) malformed.push(field);
      resolved[field] = null;
      continue;
    }
    const target = resolveRef(collection, sourceId);
    if (target == null) missing.push(field);
    resolved[field] = target;
  }
  return { resolved, missing, malformed };
}
function resolveIssueLabels(record, resolveRef) {
  const labelIds = [],
    missing = [];
  for (const sourceId of record.labelIds ?? []) {
    const target = resolveRef('issueLabels', sourceId);
    if (target == null) missing.push('label:' + sourceId);
    else labelIds.push(target);
  }
  // Sorted: label ORDER is not part of the value being 3-way merged, only label
  // MEMBERSHIP is. An unsorted array compared via JSON.stringify equality would
  // manufacture a false conflict whenever this side's order happens to differ from the
  // (also sorted) baseline/local side, silently dropping a real remote change.
  return { labelIds: [...labelIds].sort((a, b) => a.localeCompare(b)), missing };
}

/**
 * @param {object} record a Linear `issues` source record (either from a frozen
 *   linear_import_records payload, or a freshly hydrated GraphQL response shaped the same way).
 * @param {(collection: string, sourceId: string) => (string|null)} resolveRef looks up
 *   `linear_source_map`; returns null when unmapped (never throws, never mints new mappings).
 */
export function mapIssue(record, resolveRef) {
  const scalarMalformed = issueMalformedFields(record);
  const refs = resolveIssueRefs(record, resolveRef);
  const labels = resolveIssueLabels(record, resolveRef);
  const malformed = [...scalarMalformed, ...refs.malformed];
  if (malformed.length) return { blocked: true, missing: [], malformed };
  const missing = [...refs.missing, ...labels.missing];
  if (missing.length) return { blocked: true, missing, malformed: [] };
  const resolved = refs.resolved;
  return {
    blocked: false,
    fields: {
      team_id: resolved.team_id,
      status_id: resolved.status_id,
      title: record.title,
      description: record.description ?? '',
      priority: Number(record.priority),
      assignee_source_id: resolved.assignee_source_id,
      creator_source_id: resolved.creator_source_id,
      project_id: resolved.project_id,
      cycle_id: resolved.cycle_id,
      milestone_id: resolved.milestone_id,
      parent_id: resolved.parent_id,
      estimate: record.estimate ?? null,
      due_date: record.dueDate ?? null,
      position: record.sortOrder ?? record.number,
      archived_at: record.archivedAt ?? null,
      trashed: Boolean(record.trashed),
      label_ids: labels.labelIds,
      number: record.number,
      key: record.identifier,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    },
  };
}

function commentMalformedFields(record) {
  const malformed = [];
  if (!uuid(record.id)) malformed.push('id');
  if (typeof record.body !== 'string') malformed.push('body');
  if (!isValidDateString(record.createdAt)) malformed.push('createdAt');
  if (!isValidDateString(record.updatedAt)) malformed.push('updatedAt');
  return malformed;
}
/** @param {object} record a Linear `comments` source record. */
export function mapComment(record, resolveRef) {
  const malformed = commentMalformedFields(record);
  if (malformed.length) return { blocked: true, missing: [], malformed };
  const issueSourceId = refId(record.issueId != null ? record.issueId : record.issue);
  const userSourceId = refId(record.user);
  const missing = [];
  const issue_id = issueSourceId == null ? null : resolveRef('issues', issueSourceId);
  // comments.issue_id is NOT NULL in our schema, but `issue` IS legitimately nullable on
  // Linear's Comment type (a comment can belong to a document/initiative/project/post
  // instead of an issue) — so a null issue here is NOT malformed input, it's a real,
  // valid Linear state that this pass simply doesn't support. Treated as a missing
  // reference (blocked/unsupported), not a malformed-payload rejection.
  if (issue_id == null) missing.push('issue_id');
  const author_source_id = userSourceId == null ? null : resolveRef('users', userSourceId);
  if (userSourceId != null && author_source_id == null) missing.push('author_source_id');
  if (missing.length) return { blocked: true, missing, malformed: [] };
  return {
    blocked: false,
    fields: {
      issue_id,
      author_source_id,
      body: record.body,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    },
  };
}
