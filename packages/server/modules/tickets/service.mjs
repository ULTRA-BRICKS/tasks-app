import { withSourceState } from '../linear-live/presentation.mjs';
import { presentActivity } from './activity.mjs';
import { queueNativeLinearChange } from '../../core/linear-events.mjs';
import { identityDirectory, personAliases, resolvePerson } from '../../core/source-people.mjs';
import { id, now, sha256, hmac, constantEqual } from '../../core/crypto.mjs';
import { assert, missing, conflict, requirePermission } from '../../core/errors.mjs';
import { assertModule } from '../../core/modules.mjs';

export async function getIssue(tx, actor, key, { includeDeleted = false } = {}) {
  requirePermission(actor, 'read');
  const issue = await tx.one(
    `SELECT i.*,s.name AS status_name,s.category AS status_category,s.color AS status_color,COALESCE(u.name,sp.name) AS assignee_name,p.name AS project_name,t.key AS team_key FROM issues i JOIN statuses s ON s.id=i.status_id LEFT JOIN users u ON u.id=i.assignee_id LEFT JOIN source_people sp ON sp.id=i.assignee_source_id AND sp.workspace_id=i.workspace_id LEFT JOIN projects p ON p.id=i.project_id JOIN teams t ON t.id=i.team_id WHERE i.workspace_id=? AND (i.id=? OR i.key=?) ${includeDeleted ? '' : 'AND i.deleted_at IS NULL'}`,
    [actor.workspace_id, key, key],
  );
  if (!issue) throw missing('Task', 'Issue');
  issue.labels = await tx.all(
    'SELECT l.* FROM labels l JOIN issue_labels il ON il.label_id=l.id WHERE il.workspace_id=? AND il.issue_id=? ORDER BY l.name',
    [actor.workspace_id, issue.id],
  );
  issue.label_ids = issue.labels.map((l) => l.id);
  issue.assignee_id ??= issue.assignee_source_id;
  // Stored-name SQL stays the fallback for former members; current people use the shared projection.
  issue.assignee_name =
    (await identityDirectory(tx, actor.workspace_id)).byAlias.get(issue.assignee_id)?.name ??
    issue.assignee_name;
  issue.creator_id = issue.creator_source_id ?? issue.creator_id;
  return issue;
}
async function workspaceRef(tx, actor, table, value, label = table) {
  if (!value) return;
  // table identifiers are fixed strings from callers, never request values.
  const found = await tx.one(`SELECT id FROM ${table} WHERE workspace_id=? AND id=?`, [
    actor.workspace_id,
    value,
  ]);
  assert(found, 422, 'INVALID_REFERENCE', `${label} is not in this workspace`);
}
export async function validateReferences(tx, actor, issue, labelIds) {
  const status = await tx.one(
    'SELECT * FROM statuses WHERE workspace_id=? AND team_id=? AND id=?',
    [actor.workspace_id, issue.team_id, issue.status_id],
  );
  assert(status, 422, 'INVALID_STATUS', 'Status does not belong to the task team');
  const assignee = await resolvePerson(tx, actor, issue.assignee_id ?? issue.assignee_source_id);
  issue.assignee_id = assignee.member;
  issue.assignee_source_id = assignee.source;
  if (issue.project_id) {
    await assertModule(tx, actor.workspace_id, 'planning');
    assert(
      await tx.one(
        'SELECT project_id FROM project_teams WHERE workspace_id=? AND project_id=? AND team_id=?',
        [actor.workspace_id, issue.project_id, issue.team_id],
      ),
      422,
      'INVALID_PROJECT',
      'Project is not assigned to this team',
    );
  }
  if (issue.cycle_id) {
    await assertModule(tx, actor.workspace_id, 'cycles');
    assert(
      await tx.one('SELECT id FROM cycles WHERE workspace_id=? AND team_id=? AND id=?', [
        actor.workspace_id,
        issue.team_id,
        issue.cycle_id,
      ]),
      422,
      'INVALID_CYCLE',
      'Cycle belongs to a different team',
    );
  }
  if (issue.milestone_id)
    assert(
      issue.project_id &&
        (await tx.one('SELECT id FROM milestones WHERE workspace_id=? AND project_id=? AND id=?', [
          actor.workspace_id,
          issue.project_id,
          issue.milestone_id,
        ])),
      422,
      'INVALID_MILESTONE',
      'Milestone must belong to the selected project',
    );
  if (issue.parent_id) {
    assert(issue.parent_id !== issue.id, 422, 'SELF_PARENT', 'A task cannot be its own parent');
    let parent = await tx.one(
      'SELECT id,parent_id,deleted_at FROM issues WHERE workspace_id=? AND id=?',
      [actor.workspace_id, issue.parent_id],
    );
    assert(parent && !parent.deleted_at, 422, 'INVALID_PARENT', 'Parent does not exist');
    const visited = new Set([issue.id]);
    for (let depth = 0; parent; depth++) {
      assert(
        !visited.has(parent.id) && depth < 100,
        422,
        'HIERARCHY_CYCLE',
        'Parent would create a cycle or exceed the 100-level depth limit',
      );
      visited.add(parent.id);
      parent = parent.parent_id
        ? await tx.one('SELECT id,parent_id FROM issues WHERE workspace_id=? AND id=?', [
            actor.workspace_id,
            parent.parent_id,
          ])
        : null;
    }
  }
  if (labelIds)
    for (const labelId of labelIds) await workspaceRef(tx, actor, 'labels', labelId, 'Label');
  assert(
    !issue.start_date || !issue.due_date || issue.start_date <= issue.due_date,
    422,
    'INVALID_DATES',
    'Due date must not precede start date',
  );
}
export async function recordActivity(tx, actor, issue, action, data = {}) {
  const created = now();
  await queueNativeLinearChange(
    tx,
    actor,
    data.comment_id ? 'comments' : 'issues',
    data.comment_id ?? issue.id,
    id(),
  );
  await tx.exec(
    'INSERT INTO activity(id,workspace_id,issue_id,actor_id,action,data,created_at) VALUES(?,?,?,?,?,?,?)',
    [id(), actor.workspace_id, issue.id, actor.id, action, JSON.stringify(data), created],
  );
  const subscriptions = await tx.all(
    'SELECT user_id FROM subscriptions WHERE workspace_id=? AND issue_id=?',
    [actor.workspace_id, issue.id],
  );
  const recipients = new Set(
    [...subscriptions.map((s) => s.user_id), issue.assignee_id].filter(Boolean),
  );
  recipients.delete(actor.id);
  // getIssue may expose imported attribution IDs as assignee_id for the UI.
  // Only real members can receive account notifications; attribution creates no access.
  if (recipients.size) {
    const members = await tx.all(
      `SELECT user_id FROM memberships WHERE workspace_id=? AND user_id IN (${[...recipients].map(() => '?').join(',')})`,
      [actor.workspace_id, ...recipients],
    );
    const allowed = new Set(members.map((member) => member.user_id));
    for (const user of recipients) if (!allowed.has(user)) recipients.delete(user);
  }
  const notifications = await tx.one(
    "SELECT enabled FROM module_settings WHERE workspace_id=? AND module='notifications'",
    [actor.workspace_id],
  );
  if (notifications?.enabled !== 0)
    for (const user of recipients)
      await tx.exec(
        'INSERT INTO notifications(id,workspace_id,user_id,issue_id,body,created_at) VALUES(?,?,?,?,?,?)',
        [
          id(),
          actor.workspace_id,
          user,
          issue.id,
          `${actor.name}: ${action} ${issue.key}`,
          created,
        ],
      );
  const modules = await tx.all(
    "SELECT module,enabled,config FROM module_settings WHERE workspace_id=? AND module IN ('slack','github')",
    [actor.workspace_id],
  );
  for (const module of modules)
    if (
      module.module === 'slack' &&
      module.enabled &&
      JSON.parse(module.config).notify &&
      !actor.integration
    ) {
      await tx.exec(
        "INSERT INTO outbox(id,workspace_id,provider,event,payload,status,attempts,next_attempt_at,created_at) VALUES(?,?,?,?,?,'pending',0,?,?)",
        [
          id(),
          actor.workspace_id,
          module.module,
          action,
          JSON.stringify({
            issue_id: issue.id,
            key: issue.key,
            title: issue.title,
            status_id: issue.status_id,
            actor: actor.name,
          }),
          created,
          created,
        ],
      );
    }
}
async function replaceLabels(tx, actor, issueId, labels) {
  await tx.exec('DELETE FROM issue_labels WHERE workspace_id=? AND issue_id=?', [
    actor.workspace_id,
    issueId,
  ]);
  for (const label of labels)
    await tx.exec('INSERT INTO issue_labels(workspace_id,issue_id,label_id) VALUES(?,?,?)', [
      actor.workspace_id,
      issueId,
      label,
    ]);
}
export async function createIssue(tx, actor, input, { idempotencyKey } = {}) {
  requirePermission(actor, 'write');
  await assertModule(tx, actor.workspace_id, 'tickets');
  if (idempotencyKey) {
    assert(
      /^[\w.:/-]{1,160}$/.test(idempotencyKey),
      422,
      'INVALID_IDEMPOTENCY_KEY',
      'Invalid idempotency key',
    );
    const previous = await tx.one(
      'SELECT * FROM idempotency_keys WHERE workspace_id=? AND user_id=? AND key=?',
      [actor.workspace_id, actor.id, idempotencyKey],
    );
    if (previous) {
      assert(
        previous.request_hash === sha256(JSON.stringify(input)),
        409,
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key was used with a different request',
      );
      const response = JSON.parse(previous.response);
      return getIssue(tx, actor, response.id, { includeDeleted: true });
    }
  }
  const team = await tx.one('SELECT * FROM teams WHERE workspace_id=? AND id=?', [
    actor.workspace_id,
    input.team_id,
  ]);
  assert(team, 422, 'INVALID_TEAM', 'Team not found');
  const defaultStatus = await tx.one(
    "SELECT id FROM statuses WHERE workspace_id=? AND team_id=? ORDER BY CASE WHEN category='unstarted' THEN 0 ELSE 1 END,position LIMIT 1",
    [actor.workspace_id, team.id],
  );
  const numbering = await tx.one(
    "SELECT config FROM module_settings WHERE workspace_id=? AND module='linear-numbering' AND enabled=1",
    [actor.workspace_id],
  );
  const pending = numbering && JSON.parse(numbering.config).teamIds.includes(team.id);
  const lowest = pending
    ? await tx.one('SELECT MIN(number) AS value FROM issues WHERE workspace_id=? AND team_id=?', [
        actor.workspace_id,
        team.id,
      ])
    : null;
  const created = now();
  const issue = {
    id: id(),
    workspace_id: actor.workspace_id,
    team_id: team.id,
    number: team.next_number,
    key: `${team.key}-${team.next_number}`,
    title: input.title.trim(),
    description: input.description ?? '',
    kind: input.kind ?? 'issue',
    status_id: input.status_id ?? defaultStatus.id,
    priority: input.priority ?? 0,
    assignee_id: input.assignee_id ?? null,
    creator_id: actor.id,
    project_id: input.project_id ?? null,
    cycle_id: input.cycle_id ?? null,
    milestone_id: input.milestone_id ?? null,
    parent_id: input.parent_id ?? null,
    estimate: input.estimate ?? null,
    start_date: input.start_date ?? null,
    due_date: input.due_date ?? null,
    position: team.next_number * 1024,
    version: 1,
    created_at: created,
    updated_at: created,
    archived_at: null,
    deleted_at: null,
  };
  if (pending) {
    issue.number = Math.min(0, Number(lowest?.value ?? 0)) - 1;
    issue.key = 'PENDING-' + issue.id;
  }
  await validateReferences(tx, actor, issue, input.label_ids ?? []);
  if (!pending) await tx.exec('UPDATE teams SET next_number=next_number+1 WHERE id=?', [team.id]);
  const columns = Object.keys(issue);
  await tx.exec(
    `INSERT INTO issues(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
    Object.values(issue),
  );
  await replaceLabels(tx, actor, issue.id, input.label_ids ?? []);
  await tx.exec('INSERT INTO subscriptions(workspace_id,issue_id,user_id) VALUES(?,?,?)', [
    actor.workspace_id,
    issue.id,
    actor.id,
  ]);
  await recordActivity(tx, actor, issue, 'created');
  const result = await getIssue(tx, actor, issue.id);
  if (idempotencyKey)
    await tx.exec(
      'INSERT INTO idempotency_keys(workspace_id,user_id,key,request_hash,response,created_at) VALUES(?,?,?,?,?,?)',
      [
        actor.workspace_id,
        actor.id,
        idempotencyKey,
        sha256(JSON.stringify(input)),
        JSON.stringify(result),
        created,
      ],
    );
  return result;
}
const editable = [
  'title',
  'description',
  'kind',
  'status_id',
  'priority',
  'assignee_id',
  'project_id',
  'cycle_id',
  'milestone_id',
  'parent_id',
  'estimate',
  'start_date',
  'due_date',
  'position',
];
export async function updateIssue(tx, actor, key, input) {
  requirePermission(actor, 'write');
  const current = await getIssue(tx, actor, key, { includeDeleted: true });
  if (input.version !== current.version) conflict(current);
  assert(
    !current.deleted_at || input.deleted === false,
    409,
    'ISSUE_DELETED',
    'Restore the task before editing',
  );
  const updated = { ...current };
  const changes = {};
  for (const field of editable)
    if (Object.hasOwn(input, field)) {
      updated[field] = field === 'title' ? input[field].trim() : input[field];
      if (current[field] !== updated[field])
        changes[field] = { from: current[field], to: updated[field] };
    }
  if (Object.hasOwn(input, 'archived')) {
    updated.archived_at = input.archived ? (current.archived_at ?? now()) : null;
    changes.archived = input.archived;
  }
  if (Object.hasOwn(input, 'deleted')) {
    updated.deleted_at = input.deleted ? (current.deleted_at ?? now()) : null;
    changes.deleted = input.deleted;
  }
  if (input.deleted) {
    const child = await tx.one(
      'SELECT id FROM issues WHERE workspace_id=? AND parent_id=? AND deleted_at IS NULL LIMIT 1',
      [actor.workspace_id, current.id],
    );
    assert(
      !child,
      409,
      'HAS_CHILDREN',
      'Move or delete active sub-tasks before deleting their parent',
    );
  }
  if (Object.hasOwn(input, 'assignee_id')) updated.assignee_source_id = null;
  await validateReferences(tx, actor, updated, input.label_ids);
  const fields = [...editable, 'assignee_source_id', 'archived_at', 'deleted_at'];
  const result = await tx.exec(
    `UPDATE issues SET ${fields.map((f) => f + '=?').join(',')},version=version+1,updated_at=? WHERE workspace_id=? AND id=? AND version=?`,
    [...fields.map((f) => updated[f]), now(), actor.workspace_id, current.id, input.version],
  );
  if (Number(result.changes) !== 1)
    conflict(await getIssue(tx, actor, key, { includeDeleted: true }));
  if (input.label_ids) {
    await replaceLabels(tx, actor, current.id, input.label_ids);
    changes.label_ids = { from: current.label_ids, to: input.label_ids };
  }
  await recordActivity(
    tx,
    actor,
    updated,
    input.deleted ? 'deleted' : input.deleted === false ? 'restored' : 'updated',
    changes,
  );
  return getIssue(tx, actor, current.id, { includeDeleted: true });
}
export async function bulkUpdate(tx, actor, updates) {
  assert(
    new Set(updates.map((u) => u.id)).size === updates.length,
    422,
    'DUPLICATE_ISSUES',
    'A task may appear only once in a bulk update',
  );
  const result = [];
  for (const { id, patch } of updates) result.push(await updateIssue(tx, actor, id, patch));
  return result;
}
function encodeCursor(data, secret) {
  const text = Buffer.from(JSON.stringify(data)).toString('base64url');
  return text + '.' + hmac(secret, text);
}
function decodeCursor(value, secret) {
  const [text, signature, ...rest] = value.split('.');
  assert(
    text && signature && !rest.length && constantEqual(signature, hmac(secret, text)),
    422,
    'INVALID_CURSOR',
    'Invalid cursor',
  );
  try {
    return JSON.parse(Buffer.from(text, 'base64url').toString());
  } catch {
    assert(false, 422, 'INVALID_CURSOR', 'Invalid cursor');
  }
}
export async function listIssues(
  tx,
  actor,
  filters = {},
  { limit = 100, cursor, secret = 'local-test-only' } = {},
) {
  requirePermission(actor, 'read');
  assert(
    Number.isInteger(limit) && limit >= 1 && limit <= 200,
    422,
    'INVALID_LIMIT',
    'Limit must be between 1 and 200',
  );
  const where = [
      'i.workspace_id=?',
      filters.deleted ? 'i.deleted_at IS NOT NULL' : 'i.deleted_at IS NULL',
      filters.archived ? 'i.archived_at IS NOT NULL' : 'i.archived_at IS NULL',
    ],
    args = [actor.workspace_id];
  for (const field of [
    'team_id',
    'status_id',
    'project_id',
    'cycle_id',
    'parent_id',
    'kind',
    'priority',
  ])
    if (Object.hasOwn(filters, field)) {
      where.push(`i.${field}=?`);
      args.push(filters[field]);
    }
  if (filters.assignee_id) {
    if (filters.assignee_id === 'unassigned')
      where.push('i.assignee_id IS NULL AND i.assignee_source_id IS NULL');
    else {
      const person = filters.assignee_id === 'me' ? actor.id : filters.assignee_id;
      // A canonical person matches every stored alias: its account and email-matched source rows.
      const ids = await personAliases(tx, actor.workspace_id, person),
        slots = ids.map(() => '?').join(',');
      where.push(`(i.assignee_id IN (${slots}) OR i.assignee_source_id IN (${slots}))`);
      args.push(...ids, ...ids);
    }
  }
  if (filters.category) {
    where.push('s.category=?');
    args.push(filters.category);
  }
  if (filters.label_id) {
    where.push(
      'EXISTS(SELECT 1 FROM issue_labels il WHERE il.issue_id=i.id AND il.label_id=? AND il.workspace_id=i.workspace_id)',
    );
    args.push(filters.label_id);
  }
  if (filters.due_before) {
    where.push('i.due_date<=?');
    args.push(filters.due_before);
  }
  if (filters.q) {
    where.push("(LOWER(i.title) LIKE ? ESCAPE '!' OR LOWER(i.key) LIKE ? ESCAPE '!')");
    const q = '%' + filters.q.toLowerCase().replace(/[!%_]/g, (c) => '!' + c) + '%';
    args.push(q, q);
  }
  const signature = sha256(
    JSON.stringify(
      Object.fromEntries(Object.entries(filters).sort(([a], [b]) => a.localeCompare(b))),
    ),
  );
  if (cursor) {
    const c = decodeCursor(cursor, secret);
    assert(
      c.workspace === actor.workspace_id && c.filter === signature,
      422,
      'CURSOR_CONTEXT',
      'Cursor belongs to a different workspace or filter',
    );
    where.push('(i.created_at<? OR (i.created_at=? AND i.id<?))');
    args.push(c.created_at, c.created_at, c.id);
  }
  const rows = await tx.all(
    `SELECT i.*,s.name AS status_name,s.category AS status_category,s.color AS status_color,COALESCE(u.name,sp.name) AS assignee_name,p.name AS project_name FROM issues i JOIN statuses s ON s.id=i.status_id LEFT JOIN users u ON u.id=i.assignee_id LEFT JOIN source_people sp ON sp.id=i.assignee_source_id AND sp.workspace_id=i.workspace_id LEFT JOIN projects p ON p.id=i.project_id WHERE ${where.join(' AND ')} ORDER BY i.created_at DESC,i.id DESC LIMIT ?`,
    [...args, limit + 1],
  );
  const hasMore = rows.length > limit,
    data = rows.slice(0, limit);
  // Bounded batch relation fetch instead of per-issue N+1 queries.
  const labels = data.length
    ? await tx.all(
        `SELECT il.issue_id,l.* FROM issue_labels il JOIN labels l ON l.id=il.label_id WHERE il.workspace_id=? AND il.issue_id IN (${data.map(() => '?').join(',')}) ORDER BY l.name`,
        [actor.workspace_id, ...data.map((i) => i.id)],
      )
    : [];
  const people = (await identityDirectory(tx, actor.workspace_id)).byAlias;
  for (const row of data) {
    row.assignee_id ??= row.assignee_source_id;
    row.assignee_name = people.get(row.assignee_id)?.name ?? row.assignee_name;
    row.creator_id = row.creator_source_id ?? row.creator_id;
    row.labels = labels.filter((l) => l.issue_id === row.id);
    row.label_ids = row.labels.map((l) => l.id);
  }
  const last = data.at(-1);
  return {
    data,
    next_cursor: hasMore
      ? encodeCursor(
          {
            workspace: actor.workspace_id,
            filter: signature,
            created_at: last.created_at,
            id: last.id,
          },
          secret,
        )
      : null,
  };
}
export async function addRelation(tx, actor, key, input) {
  requirePermission(actor, 'write');
  const source = await getIssue(tx, actor, key),
    target = await getIssue(tx, actor, input.target_id);
  assert(source.id !== target.id, 422, 'SELF_RELATION', 'Cannot link a task to itself');
  let from = source.id,
    to = target.id;
  if (input.type === 'related' && from > to) [from, to] = [to, from];
  if (input.type === 'blocks' || input.type === 'duplicates') {
    const edges = await tx.all(
      'SELECT source_id,target_id FROM relations WHERE workspace_id=? AND type=?',
      [actor.workspace_id, input.type],
    );
    const visited = new Set(),
      todo = [to];
    while (todo.length) {
      const n = todo.pop();
      assert(n !== from, 422, 'RELATION_CYCLE', 'This relationship would create a cycle');
      if (visited.has(n)) continue;
      visited.add(n);
      for (const e of edges) if (e.source_id === n) todo.push(e.target_id);
    }
  }
  const existing = await tx.one(
    'SELECT * FROM relations WHERE workspace_id=? AND source_id=? AND target_id=? AND type=?',
    [actor.workspace_id, from, to, input.type],
  );
  if (existing) return existing;
  const relation = {
    id: id(),
    workspace_id: actor.workspace_id,
    source_id: from,
    target_id: to,
    type: input.type,
  };
  await tx.exec(
    'INSERT INTO relations(id,workspace_id,source_id,target_id,type) VALUES(?,?,?,?,?)',
    Object.values(relation),
  );
  await recordActivity(tx, actor, source, 'linked', { target: target.key, type: input.type });
  return relation;
}
export async function addComment(tx, actor, key, body) {
  requirePermission(actor, 'write');
  const issue = await getIssue(tx, actor, key),
    created = now();
  const comment = {
    id: id(),
    workspace_id: actor.workspace_id,
    issue_id: issue.id,
    author_id: actor.id,
    body,
    created_at: created,
    updated_at: created,
    version: 1,
  };
  await tx.exec(
    'INSERT INTO comments(id,workspace_id,issue_id,author_id,body,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?)',
    Object.values(comment),
  );
  await tx.exec(
    'INSERT INTO subscriptions(workspace_id,issue_id,user_id) VALUES(?,?,?) ON CONFLICT(issue_id,user_id) DO NOTHING',
    [actor.workspace_id, issue.id, actor.id],
  );
  await recordActivity(tx, actor, issue, 'commented', { comment_id: comment.id });
  const people = (await identityDirectory(tx, actor.workspace_id)).byAlias;
  return { ...comment, author_name: people.get(actor.id)?.name ?? actor.name };
}
export async function issueDetails(tx, actor, key) {
  const issue = await getIssue(tx, actor, key);
  // The SQL names below are the fallback for IDs the projection does not know (former members).
  const comments = await tx.all(
    'SELECT c.*,COALESCE(sp.name,u.name) AS author_name FROM comments c JOIN users u ON u.id=c.author_id LEFT JOIN source_people sp ON sp.id=c.author_source_id AND sp.workspace_id=c.workspace_id WHERE c.workspace_id=? AND c.issue_id=? ORDER BY c.created_at,c.id',
    [actor.workspace_id, issue.id],
  );
  const activity = await tx.all(
    "SELECT a.*,CASE WHEN a.action='linear_imported_change' THEN COALESCE(sp.name,'Linear automation') ELSE u.name END AS actor_name FROM activity a JOIN users u ON u.id=a.actor_id LEFT JOIN source_people sp ON sp.id=a.actor_source_id AND sp.workspace_id=a.workspace_id WHERE a.workspace_id=? AND a.issue_id=? ORDER BY a.created_at DESC,a.id DESC LIMIT 200",
    [actor.workspace_id, issue.id],
  );
  const people = (await identityDirectory(tx, actor.workspace_id)).byAlias;
  for (const comment of comments)
    comment.author_name =
      people.get(comment.author_source_id ?? comment.author_id)?.name ?? comment.author_name;
  for (const row of activity) {
    const person = row.action === 'linear_imported_change' ? row.actor_source_id : row.actor_id;
    if (person) row.actor_name = people.get(person)?.name ?? row.actor_name;
  }
  const relations = await tx.all(
    'SELECT r.*,s.key AS source_key,t.key AS target_key,s.title AS source_title,t.title AS target_title FROM relations r JOIN issues s ON s.id=r.source_id JOIN issues t ON t.id=r.target_id WHERE r.workspace_id=? AND (r.source_id=? OR r.target_id=?)',
    [actor.workspace_id, issue.id, issue.id],
  );
  const children = await tx.all(
    'SELECT id,key,title,status_id,kind FROM issues WHERE workspace_id=? AND parent_id=? AND deleted_at IS NULL ORDER BY position',
    [actor.workspace_id, issue.id],
  );
  const attachments = await tx.all(
    "SELECT id,filename,mime,bytes,created_at FROM attachments WHERE workspace_id=? AND issue_id=? AND status='ready' ORDER BY created_at",
    [actor.workspace_id, issue.id],
  );
  const links = await tx.all('SELECT * FROM external_links WHERE workspace_id=? AND issue_id=?', [
    actor.workspace_id,
    issue.id,
  ]);
  const subscribed = Boolean(
    await tx.one(
      'SELECT user_id FROM subscriptions WHERE workspace_id=? AND issue_id=? AND user_id=?',
      [actor.workspace_id, issue.id, actor.id],
    ),
  );
  return {
    ...(await withSourceState(tx, actor.workspace_id, 'issues', [issue]))[0],
    comments: await withSourceState(tx, actor.workspace_id, 'comments', comments),
    activity: await presentActivity(tx, actor.workspace_id, issue.id, activity, links),
    relations,
    children,
    attachments,
    links,
    subscribed,
  };
}
