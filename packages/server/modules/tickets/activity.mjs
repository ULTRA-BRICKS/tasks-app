import { uuid, targetId } from '../../../imports/linear-source.mjs';
import { identityDirectory } from '../../core/source-people.mjs';

// Linear history suffix, display label, source collection, empty value, presented field.
const fields = [
  ['StateId', 'Status', 'workflowStates', 'Not set', 'status'],
  ['AssigneeId', 'Assignee', 'users', 'Unassigned', 'assignee'],
  ['Priority', 'Priority', null, 'No priority', 'priority'],
  ['Title', 'Title', null, 'Untitled', 'title'],
  ['TeamId', 'Team', 'teams', 'No team', 'team'],
  ['ProjectId', 'Project', 'projects', 'No project', 'project'],
  ['ProjectMilestoneId', 'Milestone', 'projectMilestones', 'No milestone', 'milestone'],
  ['CycleId', 'Cycle', 'cycles', 'No cycle', 'cycle'],
  ['ParentId', 'Parent task', 'issues', 'No parent', 'parent'],
  ['Estimate', 'Estimate', null, 'Not estimated', 'estimate'],
  ['DueDate', 'Due date', null, 'No due date', 'due_date'],
];
const priorityNames = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit = 200) => {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  return cleaned.length > limit ? cleaned.slice(0, limit) + '…' : cleaned;
};
const list = (value) => (Array.isArray(value) ? value : []);
const dayFormat = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
// Date-only values are calendar days: format them in UTC so no timezone shifts the day.
const day = (value) => {
  const noon =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? Date.parse(value + 'T12:00:00Z')
      : NaN;
  return Number.isNaN(noon) ? text(value) || 'Unavailable value' : dayFormat.format(noon);
};
const kinds = { issue: 'Task', epic: 'Epic' };
// Values that are not references, keyed by presented field; shared by native and imported history.
function scalar(field, value) {
  if (field === 'priority')
    return Number.isInteger(value) && value >= 0 && value <= 4
      ? priorityNames[value]
      : 'Unknown priority';
  if (field === 'type') return Object.hasOwn(kinds, value) ? kinds[value] : 'Unknown type';
  if (field === 'start_date' || field === 'due_date') return day(value);
  return text(value) || 'Unavailable value';
}
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
  return [...new Set(list(values).filter((value) => typeof value === 'string'))].map((value) =>
    resolve(collection, value),
  );
}
const unavailable = {
  workflowStates: 'Unavailable status',
  users: 'Unavailable person',
  teams: 'Unavailable team',
  projects: 'Unavailable project',
  projectMilestones: 'Unavailable milestone',
  cycles: 'Unavailable cycle',
  issues: 'Unavailable task',
  issueLabels: 'Unavailable label',
  attachments: 'Unavailable attachment',
};

const verbs = new Set([
  'created the task in Linear',
  'commented in Linear',
  'archived the task',
  'restored the task from the archive',
  'moved the task to trash',
  'restored the task from trash',
]);
// A presentation only: preserve the immutable action code, source payload and timestamps.
export function describeImportedChange(
  raw,
  resolve = (collection) => unavailable[collection],
  person = () => undefined,
) {
  const event = payload(raw),
    notes = [],
    changes = [];
  if (event.sourceCreated === true) notes.push('created the task in Linear');
  if (event.sourceCommented === true) notes.push('commented in Linear');
  for (const [suffix, label, collection, empty, field] of fields) {
    const before = valueAt(event, 'from' + suffix),
      after = valueAt(event, 'to' + suffix);
    if (before === after || (before === null && after === null)) continue;
    const key = (value) => (object(value) ? value.id : value);
    const render = (value) => {
      if (value === null) return empty;
      if (collection)
        return (
          // A Linear user shown by its canonical Tasks name when the projection knows it.
          (collection === 'users' && person(key(value))?.name) ||
          (object(value) ? text(value.name) : '') ||
          resolve(collection, key(value))
        );
      return scalar(field, value);
    };
    const change = { kind: 'value', field, label, from: render(before), to: render(after) };
    // The canonical person behind a Linear user, for the client's avatar and person card.
    if (collection === 'users') {
      change.from_id = before === null ? null : (person(key(before))?.id ?? null);
      change.to_id = after === null ? null : (person(key(after))?.id ?? null);
    }
    changes.push(change);
  }
  // Linear history records that the description changed, never its text.
  if (event.updatedDescription === true || list(event.changes?.descriptionUpdatedByIds).length)
    changes.push({
      kind: 'text',
      field: 'description',
      label: 'Description',
      from: null,
      to: null,
    });
  const added = names(event.addedLabelIds, resolve, 'issueLabels'),
    removed = names(event.removedLabelIds, resolve, 'issueLabels');
  if (added.length || removed.length)
    changes.push({ kind: 'labels', field: 'labels', label: 'Labels', added, removed });
  if (event.attachmentId)
    notes.push('updated attachment: ' + resolve('attachments', event.attachmentId));
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
    notes.push(
      'updated task links' +
        (related.length
          ? ': ' +
            related.slice(0, 8).join(', ') +
            (related.length > 8 ? ` and ${related.length - 8} more` : '')
          : ''),
    );
  }
  if (event.archived === true) notes.push('archived the task');
  else if (event.archived === false) notes.push('restored the task from the archive');
  if (event.trashed === true) notes.push('moved the task to trash');
  else if (event.trashed === false) notes.push('restored the task from trash');
  const unique = [...new Set(notes)];
  const summary =
    unique.find((note) => verbs.has(note)) ??
    (changes.length ? 'updated the task' : (unique[0] ?? 'updated the task in Linear'));
  return { summary, changes, details: unique.filter((note) => note !== summary) };
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
  created: 'created the task',
  updated: 'updated the task',
  deleted: 'moved the task to trash',
  restored: 'restored the task',
  commented: 'added a comment',
  linked: 'linked a task',
  unlinked: 'removed a task link',
  'edited comment': 'edited a comment',
  attached: 'attached a file',
  archived: 'archived the task',
};
// Native rows store `{ field: { from, to } }` for every edited field (tickets service updateIssue).
// Same column order as `fields`: stored field, display label, name table, empty value, presented field.
const nativeFields = [
  ['title', 'Title', null, 'Untitled', 'title'],
  ['status_id', 'Status', 'statuses', 'Not set', 'status'],
  ['assignee_id', 'Assignee', 'people', 'Unassigned', 'assignee'],
  ['priority', 'Priority', null, 'No priority', 'priority'],
  ['kind', 'Type', null, 'No type', 'type'],
  ['team_id', 'Team', 'teams', 'No team', 'team'],
  ['key', 'ID', null, 'No ID', 'id'],
  ['project_id', 'Project', 'projects', 'No project', 'project'],
  ['milestone_id', 'Milestone', 'milestones', 'No milestone', 'milestone'],
  ['cycle_id', 'Cycle', 'cycles', 'No cycle', 'cycle'],
  ['parent_id', 'Parent task', 'issues', 'No parent', 'parent'],
  ['estimate', 'Estimate', null, 'Not estimated', 'estimate'],
  ['start_date', 'Start date', null, 'No start date', 'start_date'],
  ['due_date', 'Due date', null, 'No due date', 'due_date'],
];
// Unavailable label, then name queries. Every query is scoped to the viewer's workspace.
const nativeTables = {
  statuses: ['Unavailable status', 'SELECT id,name FROM statuses WHERE workspace_id=? AND id IN'],
  people: [
    'Unavailable person',
    'SELECT u.id,u.name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.workspace_id=? AND u.id IN',
    'SELECT id,name FROM source_people WHERE workspace_id=? AND id IN',
  ],
  teams: ['Unavailable team', 'SELECT id,name FROM teams WHERE workspace_id=? AND id IN'],
  projects: ['Unavailable project', 'SELECT id,name FROM projects WHERE workspace_id=? AND id IN'],
  milestones: [
    'Unavailable milestone',
    'SELECT id,name FROM milestones WHERE workspace_id=? AND id IN',
  ],
  cycles: ['Unavailable cycle', 'SELECT id,name FROM cycles WHERE workspace_id=? AND id IN'],
  issues: ['Unavailable task', 'SELECT id,key AS name FROM issues WHERE workspace_id=? AND id IN'],
  labels: ['Unavailable label', 'SELECT id,name FROM labels WHERE workspace_id=? AND id IN'],
};
const fieldActions = new Set(['updated', 'deleted', 'restored']);
// IDs per name query; the 200-event activity window bounds the total.
const LOOKUP_BATCH = 500;
const stored = (data, key) => (Object.hasOwn(data, key) && object(data[key]) ? data[key] : null);
async function nativeNames(tx, workspace, events) {
  const groups = new Map();
  const add = (table, value) => {
    if (typeof value !== 'string' || !value) return;
    if (!groups.has(table)) groups.set(table, new Set());
    groups.get(table).add(value);
  };
  for (const data of events) {
    for (const [key, , table] of nativeFields)
      if (table) {
        add(table, stored(data, key)?.from);
        add(table, stored(data, key)?.to);
      }
    const labels = stored(data, 'label_ids');
    for (const value of [...list(labels?.from), ...list(labels?.to)]) add('labels', value);
  }
  const found = new Map();
  // A stored person ID (member, Linear or Slack alias) shows its canonical name from the identity
  // projection, as elsewhere on the server; IDs it does not know fall back to their stored names.
  const people = groups.get('people');
  if (people) {
    const directory = await identityDirectory(tx, workspace);
    for (const id of people) {
      const canonical = text(directory.byAlias.get(id)?.name);
      if (!canonical) continue;
      found.set('people:' + id, canonical);
      people.delete(id);
    }
  }
  for (const [table, ids] of groups) {
    const values = [...ids],
      [missing, ...queries] = nativeTables[table];
    for (let start = 0; start < values.length; start += LOOKUP_BATCH) {
      const batch = values.slice(start, start + LOOKUP_BATCH);
      for (const sql of queries)
        for (const row of await tx.all(`${sql} (${batch.map(() => '?').join(',')})`, [
          workspace,
          ...batch,
        ]))
          if (!found.has(table + ':' + row.id))
            found.set(table + ':' + row.id, text(row.name) || missing);
    }
  }
  return (table, value) => found.get(table + ':' + value) ?? nativeTables[table][0];
}
export function describeNativeChange(action, data, name) {
  const changes = [],
    details = [];
  if (fieldActions.has(action)) {
    for (const [key, label, table, empty, field] of nativeFields) {
      const change = stored(data, key);
      if (!change || (change.from ?? null) === (change.to ?? null)) continue;
      const render = (value) => {
        if (value === null || value === undefined || value === '') return empty;
        if (table) return typeof value === 'string' ? name(table, value) : nativeTables[table][0];
        return scalar(field, value);
      };
      const presented = {
        kind: 'value',
        field,
        label,
        from: render(change.from),
        to: render(change.to),
      };
      // The stored person ID (member or alias) behind each name, for the client's avatar and card;
      // a missing or empty value means the field was cleared.
      if (table === 'people') {
        const personId = (value) => (typeof value === 'string' && value ? value : null);
        presented.from_id = personId(change.from);
        presented.to_id = personId(change.to);
      }
      changes.push(presented);
    }
    const labels = stored(data, 'label_ids');
    if (labels) {
      const before = new Set(list(labels.from)),
        after = new Set(list(labels.to));
      const shown = (values) =>
        values.map((value) => name('labels', value)).sort((a, b) => a.localeCompare(b));
      const added = shown([...after].filter((value) => !before.has(value))),
        removed = shown([...before].filter((value) => !after.has(value)));
      if (added.length || removed.length)
        changes.push({ kind: 'labels', field: 'labels', label: 'Labels', added, removed });
    }
    const description = stored(data, 'description');
    if (description) {
      const from = typeof description.from === 'string' ? description.from : '',
        to = typeof description.to === 'string' ? description.to : '';
      if (from !== to)
        changes.push({ kind: 'text', field: 'description', label: 'Description', from, to });
    }
    if (stored(data, 'position')) details.push('reordered the task');
  }
  // Archiving is its own entry, like imported history, so it never merges into a group of edits.
  // Writers record archiving as an `updated` row with `archived`; no current writer emits the
  // `archived` action code, which nativeActions still words for any stored row that has it.
  let summary = Object.hasOwn(nativeActions, action) ? nativeActions[action] : 'updated the task';
  if (action === 'updated' && typeof data.archived === 'boolean')
    summary = data.archived ? 'archived the task' : 'restored the task from the archive';
  return { summary, changes, details };
}
export async function presentActivity(tx, workspace, issueId, rows, links = []) {
  const parsed = rows.map((row) => ({ ...row, data: payload(row.data) }));
  const imported = parsed.filter((row) => row.action === 'linear_imported_change');
  const refs = references(imported.map((row) => row.data));
  const name = await nativeNames(
    tx,
    workspace,
    parsed.filter((row) => fieldActions.has(row.action)).map((row) => row.data),
  );
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
  const resolve = (collection, key) =>
    lookup.get(collection + ':' + key) ?? unavailable[collection];
  const mentionsPeople = imported.some((row) =>
    fields.some(
      ([suffix, , collection]) =>
        collection === 'users' &&
        (valueAt(row.data, 'from' + suffix) ?? valueAt(row.data, 'to' + suffix)) !== null,
    ),
  );
  const directory = mentionsPeople ? await identityDirectory(tx, workspace) : null;
  // Payloads name Linear user IDs (source_id), not stored person IDs; issueDetails names the row actor.
  const person = (key) => directory?.bySource.get('linear:' + key);
  return parsed.map((row) =>
    row.action === 'linear_imported_change'
      ? {
          ...row,
          ...describeImportedChange(row.data, resolve, person),
          actor_name: row.actor_source_id ? row.actor_name : 'Linear',
        }
      : { ...row, ...describeNativeChange(row.action, row.data, name) },
  );
}
