const changedFields = {
  title: 'title',
  description: 'description',
  status_id: 'status',
  priority: 'priority',
  assignee_id: 'assignee',
  project_id: 'project',
  cycle_id: 'cycle',
  label_ids: 'labels',
  parent_id: 'parent issue',
  milestone_id: 'milestone',
  due_date: 'due date',
  estimate: 'estimate',
  team_id: 'team',
  start_date: 'start date',
  kind: 'issue type',
  position: 'position',
};
const sourceFields = [
  ['State', 'workflowStates', 'status'],
  ['Assignee', 'users', 'assignee'],
  ['Project', 'projects', 'project'],
  ['Cycle', 'cycles', 'cycle'],
  ['Team', 'teams', 'team'],
  ['Parent', 'issues', 'parent issue'],
];
const priorities = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];
const shorten = (value) => String(value).slice(0, 180);
export function sourceReferences(event) {
  const refs = [];
  for (const [field, collection] of sourceFields)
    for (const side of ['from', 'to']) {
      const value = event?.[side + field + 'Id'];
      if (typeof value === 'string') refs.push([collection, value]);
    }
  for (const key of ['addedLabelIds', 'removedLabelIds'])
    for (const value of Array.isArray(event?.[key]) ? event[key] : [])
      if (typeof value === 'string') refs.push(['issueLabels', value]);
  return refs;
}
export function describeActivity(action, data = {}, names = new Map()) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
  if (action !== 'linear_imported_change') {
    const known = {
      created: 'created this issue',
      deleted: 'deleted this issue',
      restored: 'restored this issue',
      commented: 'added a comment',
      linked: 'linked an issue',
      subscribed: 'subscribed to this issue',
      unsubscribed: 'unsubscribed from this issue',
    };
    if (known[action]) return known[action];
    const fields = Object.keys(data)
      .filter((key) => changedFields[key])
      .map((key) => changedFields[key]);
    return fields.length ? 'changed ' + fields.join(', ') : 'updated this issue';
  }
  const changes = [];
  for (const [field, collection, label] of sourceFields) {
    const before = data['from' + field + 'Id'],
      after = data['to' + field + 'Id'];
    if (before === after || (before == null && after == null)) continue;
    const from = names.get(collection + ':' + before),
      to = names.get(collection + ':' + after);
    changes.push(
      after === null
        ? 'removed the ' + label
        : to
          ? from
            ? `changed ${label} from ${shorten(from)} to ${shorten(to)}`
            : `set ${label} to ${shorten(to)}`
          : 'changed ' + label,
    );
  }
  if (data.toTitle != null && data.toTitle !== data.fromTitle)
    changes.push('changed title to “' + shorten(data.toTitle) + '”');
  if (data.updatedDescription) changes.push('updated the description');
  for (const [field, label] of [
    ['Priority', 'priority'],
    ['Estimate', 'estimate'],
    ['DueDate', 'due date'],
  ]) {
    const before = data['from' + field],
      after = data['to' + field];
    if (before === after || (before == null && after == null)) continue;
    const value = field === 'Priority' ? priorities[after] : after;
    changes.push(
      after === null
        ? 'cleared the ' + label
        : value !== undefined
          ? `set ${label} to ${shorten(value)}`
          : 'changed ' + label,
    );
  }
  for (const [key, verb] of [
    ['addedLabelIds', 'added'],
    ['removedLabelIds', 'removed'],
  ]) {
    const ids = Array.isArray(data[key]) ? data[key] : [];
    if (ids.length) {
      const labels = ids
        .map((id) => names.get('issueLabels:' + id))
        .filter(Boolean)
        .map(shorten);
      const unknown = ids.length - labels.length;
      const detail = [
        ...labels,
        ...(unknown ? [unknown + (unknown === 1 ? ' label' : ' labels')] : []),
      ].join(', ');
      changes.push(verb + ' ' + detail);
    }
  }
  if (data.archived === true) changes.push('archived this issue');
  if (data.archived === false) changes.push('restored this issue from the archive');
  if (data.trashed === true) changes.push('moved this issue to trash');
  if (data.relationChanges) changes.push('changed issue relationships');
  return changes.length ? changes.join('; ') : 'updated this issue in Linear';
}
export async function presentActivities(tx, workspaceId, rows) {
  const parsed = rows.map((row) => {
    let data;
    try {
      data = JSON.parse(row.data);
    } catch {
      data = {};
    }
    return { ...row, data };
  });
  const ids = [
    ...new Set(
      parsed
        .filter((row) => row.action === 'linear_imported_change')
        .flatMap((row) => sourceReferences(row.data).map((ref) => ref[1])),
    ),
  ];
  const names = new Map();
  for (let offset = 0; offset < ids.length; offset += 200) {
    const batch = ids.slice(offset, offset + 200);
    const records = await tx.all(
      `SELECT r.collection,r.source_id,r.payload FROM linear_import_records r JOIN linear_source_map m ON m.workspace_id=r.workspace_id AND m.import_id=r.import_id AND m.collection=r.collection AND m.source_id=r.source_id WHERE r.workspace_id=? AND r.source_id IN (${batch.map(() => '?').join(',')})`,
      [workspaceId, ...batch],
    );
    for (const record of records) {
      try {
        const source = JSON.parse(record.payload);
        const name = source.name ?? source.title ?? source.identifier;
        if (typeof name === 'string') names.set(record.collection + ':' + record.source_id, name);
      } catch {
        /* Missing historical metadata must not prevent reading the issue. */
      }
    }
  }
  return parsed.map((row) => ({ ...row, summary: describeActivity(row.action, row.data, names) }));
}
