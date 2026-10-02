import { uuid, targetId } from '../../../imports/linear-source.mjs';

const fields = [
  ['StateId', 'status', 'workflowStates', 'Not set'],
  ['AssigneeId', 'assignee', 'users', 'Unassigned'],
  ['Priority', 'priority', null, 'No priority'],
  ['Title', 'title', null, 'Untitled'],
  ['TeamId', 'team', 'teams', 'No team'],
  ['ProjectId', 'project', 'projects', 'No project'],
  ['ProjectMilestoneId', 'milestone', 'projectMilestones', 'No milestone'],
  ['CycleId', 'cycle', 'cycles', 'No cycle'],
  ['ParentId', 'parent issue', 'issues', 'No parent'],
  ['Estimate', 'estimate', null, 'Not estimated'],
  ['DueDate', 'due date', null, 'No due date'],
];
const priorityNames = ['No priority', 'Urgent', 'High', 'Normal', 'Low'];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit = 200) => {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  return cleaned.length > limit ? cleaned.slice(0, limit) + '…' : cleaned;
};
const list = (value) => (Array.isArray(value) ? value : []);
function payload(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return object(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function valueAt(event, key) {
  const alias = key.replace(/ProjectMilestoneId$/, 'ProjectMilestone');
  for (const container of [event, object(event.changes) ? event.changes : {}]) {
    if (Object.hasOwn(container, key)) return container[key] ?? null;
    if (alias !== key && Object.hasOwn(container, alias)) return container[alias] ?? null;
  }
  return null;
}
function names(values, resolve, collection) {
  const all = [...new Set(list(values).filter((value) => typeof value === 'string'))];
  const shown = all.slice(0, 8).map((value) => resolve(collection, value));
  return (
    shown.join(', ') + (all.length > shown.length ? ` and ${all.length - shown.length} more` : '')
  );
}
const unavailable = {
  workflowStates: 'Unavailable status',
  users: 'Unavailable person',
  teams: 'Unavailable team',
  projects: 'Unavailable project',
  projectMilestones: 'Unavailable milestone',
  cycles: 'Unavailable cycle',
  issues: 'Unavailable issue',
  issueLabels: 'Unavailable label',
  attachments: 'Unavailable attachment',
};

// A presentation only: preserve the immutable action code, source payload and timestamps.
export function describeImportedChange(raw, resolve = (collection) => unavailable[collection]) {
  const event = payload(raw),
    lines = [];
  for (const [suffix, label, collection, empty] of fields) {
    const before = valueAt(event, 'from' + suffix),
      after = valueAt(event, 'to' + suffix);
    if (before === after || (before === null && after === null)) continue;
    const render = (value) => {
      if (value === null) return empty;
      if (collection)
        return (
          (object(value) ? text(value.name) : '') ||
          resolve(collection, object(value) ? value.id : value)
        );
      if (suffix === 'Priority')
        return Number.isInteger(value) && value >= 0 && value <= 4
          ? priorityNames[value]
          : 'Unknown priority';
      return text(value) || 'Unavailable value';
    };
    lines.push(`changed ${label}: ${render(before)} → ${render(after)}`);
  }
  if (event.updatedDescription === true || list(event.changes?.descriptionUpdatedByIds).length)
    lines.push('updated the description');
  for (const [key, verb] of [
    ['addedLabelIds', 'added labels'],
    ['removedLabelIds', 'removed labels'],
  ]) {
    const labels = names(event[key], resolve, 'issueLabels');
    if (labels) lines.push(verb + ': ' + labels);
  }
  if (event.attachmentId)
    lines.push('updated attachment: ' + resolve('attachments', event.attachmentId));
  const related = [
    ...new Set(
      list(event.relationChanges)
        .map((change) => change?.identifier)
        .filter(
          (identifier) =>
            typeof identifier === 'string' && /^[A-Z][A-Z0-9]{1,9}-\d+$/.test(identifier),
        ),
    ),
  ];
  // Linear's abbreviated relation operation codes are not an API contract: do not invent their meaning.
  if (list(event.relationChanges).length) {
    lines.push(
      'updated issue links' +
        (related.length
          ? ': ' +
            related.slice(0, 8).join(', ') +
            (related.length > 8 ? ` and ${related.length - 8} more` : '')
          : ''),
    );
  }
  if (event.archived === true) lines.push('archived the issue');
  else if (event.archived === false) lines.push('restored the issue from the archive');
  if (event.trashed === true) lines.push('moved the issue to trash');
  else if (event.trashed === false) lines.push('restored the issue from trash');
  // A verified Linear-side deletion/restore, distinct from the native trash/archive flags
  // above: the item was removed/restored in Linear itself, not locally. sourceRemoved and
  // sourceRestored can both be true in the SAME window (removed, then restored later) but
  // never on the SAME activity row (see worker.mjs's applyRemove/handleImplicitRestore,
  // which always insert them as separate rows).
  if (event.sourceRemoved === true)
    lines.push(
      event.sourceRemovalConflict === true
        ? 'was deleted in Linear (local changes were kept, flagged for review)'
        : 'was deleted in Linear',
    );
  if (event.sourceRestored === true) lines.push('was restored in Linear');
  const unique = [...new Set(lines)];
  return { summary: unique[0] ?? 'updated the issue in Linear', details: unique.slice(1) };
}

function references(events) {
  const groups = new Map();
  let count = 0;
  const add = (collection, value) => {
    if (object(value) && text(value.name)) return;
    const key = object(value) ? value.id : value;
    if (count >= 2000 || !uuid(key)) return;
    if (!groups.has(collection)) groups.set(collection, new Set());
    const group = groups.get(collection);
    if (!group.has(key)) {
      group.add(key);
      count++;
    }
  };
  for (const event of events) {
    for (const [suffix, , collection] of fields)
      if (collection) {
        add(collection, valueAt(event, 'from' + suffix));
        add(collection, valueAt(event, 'to' + suffix));
      }
    for (const value of list(event.addedLabelIds).slice(0, 2000)) add('issueLabels', value);
    for (const value of list(event.removedLabelIds).slice(0, 2000)) add('issueLabels', value);
    add('attachments', event.attachmentId);
    if (count >= 2000) break;
  }
  return groups;
}
function sourceName(collection, record) {
  const label =
    collection === 'issues'
      ? record.identifier
      : (record.name ?? record.title ?? record.displayName);
  return text(label) || unavailable[collection];
}
const nativeActions = {
  created: 'created the issue',
  updated: 'updated the issue',
  deleted: 'moved the issue to trash',
  restored: 'restored the issue',
  commented: 'added a comment',
  linked: 'linked an issue',
  unlinked: 'removed an issue link',
  'edited comment': 'edited a comment',
  attached: 'attached a file',
  archived: 'archived the issue',
};
export async function presentActivity(tx, workspace, issueId, rows, links = []) {
  const parsed = rows.map((row) => ({ ...row, data: payload(row.data) }));
  const imported = parsed.filter((row) => row.action === 'linear_imported_change');
  const refs = references(imported.map((row) => row.data));
  const lookup = new Map();
  // The native detail response already loads this stable source pointer. Avoid a reverse-map scan.
  const sourceId = links.find(
    (link) => link.provider === 'linear' && uuid(link.external_id),
  )?.external_id;
  if (refs.size && sourceId) {
    const candidates = await tx.all(
      "SELECT r.import_id,r.source_id,i.source_workspace_id FROM linear_import_records r JOIN linear_imports i ON i.id=r.import_id AND i.workspace_id=r.workspace_id WHERE r.workspace_id=? AND r.collection='issues' AND r.source_id=? AND i.status='completed' ORDER BY i.completed_at DESC LIMIT 16",
      [workspace, sourceId],
    );
    const scope = candidates.find(
      (candidate) =>
        targetId(workspace, candidate.source_workspace_id, 'issues', candidate.source_id) ===
        issueId,
    );
    if (scope)
      for (const [collection, ids] of refs) {
        const values = [...ids];
        const records = await tx.all(
          `SELECT collection,source_id,payload FROM linear_import_records WHERE workspace_id=? AND import_id=? AND collection=? AND source_id IN (${values.map(() => '?').join(',')})`,
          [workspace, scope.import_id, collection, ...values],
        );
        for (const record of records)
          if (Object.hasOwn(unavailable, record.collection))
            lookup.set(
              record.collection + ':' + record.source_id,
              sourceName(record.collection, payload(record.payload)),
            );
      }
  }
  // Fallback for issues that appeared after the import (no linear_import_records row): the
  // live sync worker caches every hydrated issue/comment payload it applies in
  // linear_sync_records. Restricted to 'issues' (the only referenced collection the sync
  // worker ever hydrates standalone) so this never adds a query for collection types that
  // can never have a sync-record row (workflowStates, users, teams, issueLabels, ...).
  if (refs.has('issues')) {
    const unresolvedIssues = [...refs.get('issues')].filter(
      (sourceId) => !lookup.has('issues:' + sourceId),
    );
    const stillMissing = unresolvedIssues.length
      ? new Map([['issues', unresolvedIssues]])
      : new Map();
    for (const [collection, ids] of stillMissing) {
      const rows = await tx.all(
        `SELECT source_id,payload FROM linear_sync_records WHERE workspace_id=? AND collection=? AND source_id IN (${ids.map(() => '?').join(',')})`,
        [workspace, collection, ...ids],
      );
      for (const record of rows)
        if (Object.hasOwn(unavailable, collection))
          lookup.set(
            collection + ':' + record.source_id,
            sourceName(collection, payload(record.payload)),
          );
    }
  }
  const resolve = (collection, key) =>
    lookup.get(collection + ':' + key) ?? unavailable[collection];
  return parsed.map((row) =>
    row.action === 'linear_imported_change'
      ? {
          ...row,
          ...describeImportedChange(row.data, resolve),
          actor_name: row.actor_source_id ? row.actor_name : 'Linear',
        }
      : {
          ...row,
          summary: Object.hasOwn(nativeActions, row.action)
            ? nativeActions[row.action]
            : 'updated the issue',
          details: [],
        },
  );
}
