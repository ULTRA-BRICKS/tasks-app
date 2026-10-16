import { assertUnboundCommentIdsAvailable } from './comment-identity.mjs';
import { insertSourceRows as insertRows } from './rows.mjs';
import { linearIssueUrl, sourceIdentifier } from './source-contract.mjs';
import { assert, requirePermission } from '../../core/errors.mjs';
import { now } from '../../core/crypto.mjs';
import { assertModule } from '../../core/modules.mjs';
import { validate } from '../../../contracts/validate.mjs';
import { schemas } from '../../../contracts/schemas.mjs';
import { canonical, collections, digest, targetId, uuid } from '../../../imports/linear-source.mjs';
import { validateReferences } from '../tickets/service.mjs';
import { prepareFiles } from './files.mjs';
const refFields = [
  ['team', 'teams'],
  ['state', 'workflowStates'],
  ['creator', 'users'],
  ['assignee', 'users'],
  ['project', 'projects'],
  ['cycle', 'cycles'],
  ['projectMilestone', 'projectMilestones'],
  ['parent', 'issues'],
];
const sourceId = (value) => (value == null ? null : typeof value === 'string' ? value : value.id);
function timestamp(value) {
  assert(
    typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T/.test(value) &&
      Number.isFinite(Date.parse(value)),
    422,
    'INVALID_SOURCE_TIME',
    'Source timestamps must be present and valid',
  );
  return new Date(value).toISOString();
}
function references(issues, comments) {
  const groups = new Map();
  const add = (collection, value) => {
    const key = sourceId(value);
    if (key == null) return;
    assert(uuid(key), 422, 'INVALID_SOURCE_ID', 'Source references must be UUIDs');
    if (!groups.has(collection)) groups.set(collection, new Set());
    groups.get(collection).add(key);
  };
  for (const row of issues) {
    for (const [field, collection] of refFields) add(collection, row[field]);
    for (const key of row.labelIds ?? []) add('issueLabels', key);
  }
  for (const row of comments) {
    add('issues', row.issueId ?? row.issue);
    add('users', row.user);
  }
  for (const row of issues) add('issues', row.id);
  for (const row of comments) add('comments', row.id);
  return groups;
}
async function loadReferences(tx, workspace, organization, groups) {
  const found = new Map();
  for (const [collection, keys] of groups) {
    const ids = [...keys];
    for (let start = 0; start < ids.length; start += 100) {
      const batch = ids.slice(start, start + 100);
      const rows = await tx.all(
        `SELECT m.collection,m.source_id,m.target_id,m.payload_hash,r.payload FROM linear_source_map m JOIN linear_import_records r ON r.workspace_id=m.workspace_id AND r.import_id=m.import_id AND r.collection=m.collection AND r.source_id=m.source_id WHERE m.workspace_id=? AND m.source_workspace_id=? AND m.collection=? AND m.source_id IN (${batch.map(() => '?').join(',')})`,
        [workspace, organization, collection, ...batch],
      );
      for (const row of rows) found.set(collection + ':' + row.source_id, row);
    }
  }
  return found;
}
function bodyMedia(input) {
  const urls = new Set();
  for (const row of [...input.issues, ...input.comments])
    for (const match of String(row.description ?? row.body ?? '').matchAll(
      /https:\/\/uploads\.linear\.app\/[^\s<>")]+/g,
    ))
      urls.add(match[0]);
  assert(
    urls.size <= 100,
    413,
    'TOO_MANY_MEDIA_REFERENCES',
    'Use smaller batches for more than100 private-media references',
  );
  return [...urls].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
function validateRecords(records, collection) {
  assert(Array.isArray(records), 422, 'INVALID_RECORDS', 'Provide source record arrays');
  assert(
    new Set(records.map((r) => r?.id)).size === records.length,
    422,
    'DUPLICATE_SOURCE_ID',
    'A source UUID may occur only once per collection',
  );
  for (const row of records) {
    assert(row && uuid(row.id), 422, 'INVALID_SOURCE_ID', 'Source records require UUIDs');
    timestamp(row.createdAt);
    timestamp(row.updatedAt);
    assert(
      canonical(row).length <= 1000000,
      413,
      'SOURCE_RECORD_TOO_LARGE',
      'Source record exceeds the bounded import limit',
    );
    if (collection === 'comments') validate({ body: row.body }, schemas.Comment);
    else {
      assert(
        Array.isArray(row.labelIds) && row.labelIds.length <= 100,
        422,
        'INVALID_LABELS',
        'Use a complete array of at most100 labels',
      );
      assert(
        row.description == null || typeof row.description === 'string',
        422,
        'INVALID_DESCRIPTION',
        'Description must be text or null',
      );
    }
  }
}
export async function appendLinearRecords(tx, actor, input) {
  requirePermission(actor, 'admin');
  await assertModule(tx, actor.workspace_id, 'tickets');
  const issues = input.issues ?? [],
    comments = input.comments ?? [],
    organization = input.source_workspace_id;
  assert(uuid(organization), 422, 'INVALID_ORGANIZATION', 'A source organization UUID is required');
  assert(
    issues.length + comments.length > 0 && issues.length + comments.length <= 50,
    422,
    'INVALID_BATCH',
    'Append one to fifty source records per batch',
  );
  validateRecords(issues, 'issues');
  validateRecords(comments, 'comments');
  if (input.plan_hash) await tx.lock(actor.workspace_id);
  const original = await tx.one(
    "SELECT id,source_workspace_id,manifest FROM linear_imports WHERE workspace_id=? AND source_workspace_id=? AND status='completed' ORDER BY created_at,id LIMIT 1",
    [actor.workspace_id, organization],
  );
  assert(
    original,
    403,
    'ORGANIZATION_NOT_ALLOWED',
    'Source organization has no completed import in this workspace',
  );
  const requestHash = digest({ issues, comments, organization, actor: actor.id });
  const runId = targetId(actor.workspace_id, organization, 'append-batch', requestHash);
  const previous = await tx.one(
    'SELECT plan_hash,result FROM linear_imports WHERE workspace_id=? AND id=? AND status=?',
    [actor.workspace_id, runId, 'completed'],
  );
  if (previous) {
    assert(
      !input.plan_hash || input.plan_hash === previous.plan_hash,
      409,
      'PLAN_CHANGED',
      'The provided plan does not match this completed batch',
    );
    return { ...JSON.parse(previous.result), unchanged: true };
  }
  const refs = await loadReferences(
    tx,
    actor.workspace_id,
    organization,
    references(issues, comments),
  );
  await assertUnboundCommentIdsAvailable(
    tx,
    actor.workspace_id,
    comments.filter((row) => !refs.has('comments:' + row.id)).map((row) => row.id),
  );
  const known = new Map(refs),
    projected = { issues: [], comments: [] },
    skipped = [];
  for (const [collection, records] of [
    ['issues', issues],
    ['comments', comments],
  ])
    for (const record of records) {
      const prior = known.get(collection + ':' + record.id);
      if (prior) {
        assert(
          prior.payload_hash === digest(record),
          409,
          'SOURCE_ALREADY_MAPPED',
          'An existing source record changed; use conflict-aware updates, never append over it',
        );
        skipped.push({ collection, source_id: record.id, target_id: prior.target_id });
      } else
        refs.set(collection + ':' + record.id, {
          collection,
          source_id: record.id,
          target_id: targetId(actor.workspace_id, organization, collection, record.id),
        });
    }
  const ref = (collection, value, required = false) => {
    const key = sourceId(value);
    if (key == null) {
      assert(!required, 409, 'MISSING_SOURCE_REFERENCE', 'A required source reference is absent');
      return null;
    }
    const item = refs.get(collection + ':' + key);
    assert(
      item,
      409,
      'MISSING_SOURCE_REFERENCE',
      'Import the referenced ' + collection + ' record first',
    );
    return item.target_id;
  };
  const sequences = new Map(),
    reserved = new Set(),
    remaining = new Map(issues.filter((r) => !known.has('issues:' + r.id)).map((r) => [r.id, r]));
  const sourceRecords = new Map();
  for (const item of known.values())
    sourceRecords.set(item.collection + ':' + item.source_id, {
      collection: item.collection,
      source_id: item.source_id,
      payload: item.payload,
      payload_hash: digest(JSON.parse(item.payload)),
    });
  while (remaining.size) {
    const size = remaining.size;
    for (const [key, record] of remaining) {
      if (record.parent && remaining.has(sourceId(record.parent))) continue;
      assert(
        !record.trashed,
        409,
        'SOURCE_REMOVAL_REQUIRES_RECONCILIATION',
        'A trashed source issue is not a new active record',
      );
      sourceIdentifier(record, true);
      assert(
        Array.isArray(record.labelIds),
        422,
        'INVALID_LABELS',
        'Source labelIds must be a complete array',
      );
      const mapped = {
        title: record.title,
        description: record.description ?? '',
        team_id: ref('teams', record.team, true),
        status_id: ref('workflowStates', record.state, true),
        priority: record.priority,
        assignee_id: ref('users', record.assignee),
        project_id: ref('projects', record.project),
        cycle_id: ref('cycles', record.cycle),
        milestone_id: ref('projectMilestones', record.projectMilestone),
        parent_id: ref('issues', record.parent),
        estimate: record.estimate ?? null,
        due_date: record.dueDate ?? null,
        label_ids: record.labelIds.map((k) => ref('issueLabels', k)),
      };
      validate(mapped, schemas.IssueCreate);
      let team = sequences.get(mapped.team_id);
      if (!team) {
        team = await tx.one('SELECT id,key,next_number FROM teams WHERE workspace_id=? AND id=?', [
          actor.workspace_id,
          mapped.team_id,
        ]);
        assert(team, 409, 'MISSING_TARGET', 'Mapped team is unavailable');
        const max = await tx.one(
          'SELECT MAX(number) AS value FROM issues WHERE workspace_id=? AND team_id=?',
          [actor.workspace_id, team.id],
        );
        team.next_number = Math.max(Number(team.next_number), Number(max.value ?? 0) + 1);
        sequences.set(team.id, team);
      }
      let number = record.number,
        keyName = team.key + '-' + number;
      const collision =
        reserved.has(keyName) ||
        (await tx.one(
          'SELECT id FROM issues WHERE workspace_id=? AND (key=? OR (team_id=? AND number=?))',
          [actor.workspace_id, keyName, team.id, number],
        ));
      if (collision) {
        number = team.next_number;
        keyName = team.key + '-' + number;
      }
      team.next_number = Math.max(team.next_number, number + 1);
      reserved.add(keyName);
      const target = ref('issues', record.id, true);
      assert(
        !(await tx.one('SELECT id FROM issues WHERE workspace_id=? AND id=?', [
          actor.workspace_id,
          target,
        ])),
        409,
        'UNMAPPED_TARGET_EXISTS',
        'A native deterministic target exists without its source mapping',
      );
      const row = {
        id: target,
        workspace_id: actor.workspace_id,
        team_id: team.id,
        number,
        key: keyName,
        title: mapped.title,
        description: mapped.description,
        kind: 'issue',
        status_id: mapped.status_id,
        priority: mapped.priority,
        creator_id: actor.id,
        creator_source_id: ref('users', record.creator),
        assignee_id: null,
        assignee_source_id: mapped.assignee_id,
        project_id: mapped.project_id,
        cycle_id: mapped.cycle_id,
        milestone_id: mapped.milestone_id,
        parent_id: mapped.parent_id,
        estimate: mapped.estimate,
        start_date: null,
        due_date: mapped.due_date,
        position: record.sortOrder ?? number,
        version: 1,
        created_at: timestamp(record.createdAt),
        updated_at: timestamp(record.updatedAt),
        archived_at: record.archivedAt ? timestamp(record.archivedAt) : null,
        deleted_at: null,
      };
      assert(Number.isFinite(row.position), 422, 'INVALID_POSITION', 'Invalid source sort order');
      for (const person of [row.creator_source_id, row.assignee_source_id])
        if (person)
          assert(
            await tx.one('SELECT id FROM source_people WHERE workspace_id=? AND id=?', [
              actor.workspace_id,
              person,
            ]),
            409,
            'MISSING_SOURCE_PERSON',
            'Mapped source person is unavailable',
          );
      const plannedParent = projected.issues.some((item) => item.row.id === row.parent_id);
      const candidate = {
        ...row,
        parent_id: plannedParent ? null : row.parent_id,
        assignee_id: row.assignee_source_id,
      };
      await validateReferences(tx, actor, candidate, mapped.label_ids);
      row.assignee_id = candidate.assignee_id;
      row.assignee_source_id = candidate.assignee_source_id;
      const sourceUrl = linearIssueUrl(record.url);
      projected.issues.push({
        row,
        label_ids: mapped.label_ids,
        source_id: record.id,
        source_identifier: record.identifier,
        source_url: sourceUrl,
        renumbered: keyName !== record.identifier,
      });
      sourceRecords.set('issues:' + record.id, {
        collection: 'issues',
        source_id: record.id,
        payload: canonical(record),
        payload_hash: digest(record),
      });
      remaining.delete(key);
    }
    assert(remaining.size < size, 409, 'CYCLIC_SOURCE_PARENT', 'Source issue parents form a cycle');
  }
  for (const record of comments) {
    if (known.has('comments:' + record.id)) continue;
    const issueId = ref('issues', record.issueId ?? record.issue, true),
      author = ref('users', record.user);
    assert(
      projected.issues.some((x) => x.row.id === issueId) ||
        (await tx.one('SELECT id FROM issues WHERE workspace_id=? AND id=?', [
          actor.workspace_id,
          issueId,
        ])),
      409,
      'MISSING_TARGET',
      'Mapped comment issue is unavailable',
    );
    if (author)
      assert(
        await tx.one('SELECT id FROM source_people WHERE workspace_id=? AND id=?', [
          actor.workspace_id,
          author,
        ]),
        409,
        'MISSING_SOURCE_PERSON',
        'Mapped comment author is unavailable',
      );
    const row = {
      id: ref('comments', record.id, true),
      workspace_id: actor.workspace_id,
      issue_id: issueId,
      author_id: actor.id,
      author_source_id: author,
      body: record.body,
      created_at: timestamp(record.createdAt),
      updated_at: timestamp(record.updatedAt),
      version: 1,
    };
    assert(
      !(await tx.one('SELECT id FROM comments WHERE workspace_id=? AND id=?', [
        actor.workspace_id,
        row.id,
      ])),
      409,
      'UNMAPPED_TARGET_EXISTS',
      'A comment target exists without its source mapping',
    );
    projected.comments.push({ row, source_id: record.id });
    sourceRecords.set('comments:' + record.id, {
      collection: 'comments',
      source_id: record.id,
      payload: canonical(record),
      payload_hash: digest(record),
    });
  }
  const media = bodyMedia({ issues, comments }),
    files = [];
  if (media.length) {
    const existing = await tx.all(
      `SELECT source_url FROM linear_import_files WHERE workspace_id=? AND source_url IN (${media.map(() => '?').join(',')})`,
      [actor.workspace_id, ...media],
    );
    const knownUrls = new Set(existing.map((row) => row.source_url));
    for (const url of media) if (!knownUrls.has(url)) files.push(url);
  }

  const planHash = digest({ requestHash, projected, skipped, files });
  const result = {
    id: runId,
    plan_hash: planHash,
    applied: false,
    created: { issues: projected.issues.length, comments: projected.comments.length },
    skipped,
    issues: projected.issues.map((x) => ({
      source_id: x.source_id,
      id: x.row.id,
      key: x.row.key,
      source_identifier: x.source_identifier,
      renumbered: x.renumbered,
    })),
    comments: projected.comments.map((x) => ({
      source_id: x.source_id,
      id: x.row.id,
      issue_id: x.row.issue_id,
    })),
    pending_media: files.length,
  };
  if (!input.plan_hash) return result;
  assert(
    input.plan_hash === planHash,
    409,
    'PLAN_CHANGED',
    'The native sequence or source batch changed; preview the updated append plan',
  );
  const stamp = now(),
    records = [...sourceRecords.values()];
  const manifest = {
    format: 'tickets-linear-snapshot-v1',
    operation: 'append-reconciliation',
    organization: { id: organization },
    base_import_id: original.id,
    verifiedAt: JSON.parse(original.manifest).verifiedAt ?? stamp,
    counts: Object.fromEntries(
      collections.map((c) => [c, records.filter((r) => r.collection === c).length]),
    ),
  };
  await tx.exec(
    "INSERT INTO linear_imports(id,workspace_id,source_workspace_id,status,manifest,plan_hash,created_by,created_at) VALUES(?,?,?,'staging',?,?,?,?)",
    [runId, actor.workspace_id, organization, canonical(manifest), planHash, actor.id, stamp],
  );
  await insertRows(
    tx,
    'linear_import_records',
    records.map((record) => ({ workspace_id: actor.workspace_id, import_id: runId, ...record })),
  );
  await insertRows(
    tx,
    'issues',
    projected.issues.map((item) => item.row),
  );
  await insertRows(
    tx,
    'issue_labels',
    projected.issues.flatMap((item) =>
      item.label_ids.map((label) => ({
        workspace_id: actor.workspace_id,
        issue_id: item.row.id,
        label_id: label,
      })),
    ),
  );
  await insertRows(
    tx,
    'external_links',
    projected.issues.map((item) => ({
      id: targetId(actor.workspace_id, organization, 'linear-link', item.source_id),
      workspace_id: actor.workspace_id,
      issue_id: item.row.id,
      provider: 'linear',
      external_id: item.source_id,
      url: item.source_url,
      title: item.source_identifier,
    })),
  );
  await insertRows(
    tx,
    'comments',
    projected.comments.map((item) => item.row),
  );
  const mappings = [],
    activity = [];
  for (const [collection, items] of [
    ['issues', projected.issues],
    ['comments', projected.comments],
  ])
    for (const item of items) {
      const source = sourceRecords.get(collection + ':' + item.source_id);
      mappings.push({
        workspace_id: actor.workspace_id,
        source_workspace_id: organization,
        collection,
        source_id: item.source_id,
        target_id: item.row.id,
        payload_hash: source.payload_hash,
        import_id: runId,
      });
      activity.push({
        id: targetId(
          actor.workspace_id,
          organization,
          'append-event:' + collection,
          item.source_id,
        ),
        workspace_id: actor.workspace_id,
        issue_id: collection === 'issues' ? item.row.id : item.row.issue_id,
        actor_id: actor.id,
        actor_source_id:
          collection === 'issues' ? item.row.creator_source_id : item.row.author_source_id,
        action: 'linear_imported_change',
        data: canonical({
          sourceCreated: collection === 'issues',
          sourceCommented: collection === 'comments',
          sourceId: item.source_id,
        }),
        created_at: item.row.created_at,
      });
    }
  await insertRows(tx, 'linear_source_map', mappings);
  await insertRows(tx, 'activity', activity);
  for (const team of sequences.values())
    await tx.exec(
      'UPDATE teams SET next_number=CASE WHEN next_number<? THEN ? ELSE next_number END WHERE workspace_id=? AND id=?',
      [team.next_number, team.next_number, actor.workspace_id, team.id],
    );
  const pendingFiles = await prepareFiles(
    tx,
    actor,
    { id: runId, source_workspace_id: organization },
    files,
  );
  const applied = {
    ...result,
    applied: true,
    files: pendingFiles.map((f) => ({ id: f.id, source_url: f.source_url, status: f.status })),
  };
  await tx.exec(
    "UPDATE linear_imports SET status='completed',completed_at=?,result=? WHERE workspace_id=? AND id=?",
    [stamp, canonical(applied), actor.workspace_id, runId],
  );
  return applied;
}
