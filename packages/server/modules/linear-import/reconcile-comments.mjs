/** Explicit provenance reconciliation, reached only by the operator or transactional callers.
 * PostgreSQL apply requires READ COMMITTED and the workspace lock before evidence reads;
 * a higher-isolation snapshot taken by a waiting lock SELECT can miss committed bindings.
 */
import { assert, requirePermission } from '../../core/errors.mjs';
import { assertModule } from '../../core/modules.mjs';
import { canonical, digest, targetId, uuid } from '../../../imports/linear-source.mjs';
import { now } from '../../core/crypto.mjs';

const operation = 'comment-identity-reconciliation';
const sameTime = (a, b) => {
  const left = Date.parse(a),
    right = Date.parse(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (a === b) return true;
  // Date cannot compare sub-millisecond evidence. Preserve identical source text,
  // but refuse differing high-precision representations rather than rounding them.
  if (/\.\d{4,}/.test(a) || /\.\d{4,}/.test(b)) return false;
  return left === right;
};
const email = (value) => typeof value === 'string' && value.trim().toLowerCase();

async function discoverReferences(tx, workspace, sourceIds) {
  const references = new Map(sourceIds.map((id) => [id, { activity: [], outbox: [] }]));
  const exceeded = new Set();
  const bytes = new Map(sourceIds.map((id) => [id, 0]));
  // SQLite LIKE folds ASCII case; PostgreSQL LIKE does not. UUID substrings can
  // occur in arbitrary historical text, including embedded and overlapping IDs.
  const key = (value) => (tx.dialect === 'sqlite' ? value.toLowerCase() : value);
  const candidates = new Map();
  for (const id of sourceIds) {
    if (!candidates.has(key(id))) candidates.set(key(id), []);
    candidates.get(key(id)).push(id);
  }
  let admitted = 0;
  for (const { table, field, columns } of [
    {
      table: 'activity',
      field: 'data',
      columns: [
        'id',
        'workspace_id',
        'issue_id',
        'actor_id',
        'action',
        'data',
        'created_at',
        'actor_source_id',
      ],
    },
    {
      table: 'outbox',
      field: 'payload',
      columns: [
        'id',
        'workspace_id',
        'provider',
        'event',
        'payload',
        'status',
        'attempts',
        'next_attempt_at',
        'last_error',
        'created_at',
      ],
    },
  ]) {
    // Admission reads only indexed keys. Payload lengths are measured only for
    // bounded candidates; an oversized first row yields an empty page and refuses.
    const size = columns
      .map((column) =>
        tx.dialect === 'postgres'
          ? `COALESCE(octet_length(CAST(${column} AS TEXT)),0)`
          : `COALESCE(length(CAST(${column} AS BLOB)),0)`,
      )
      .join('+');
    const budget = await tx.one(
      `SELECT COUNT(*) AS count FROM (SELECT id FROM ${table} WHERE workspace_id=? LIMIT 100001) AS bounded_history`,
      [workspace],
    );
    admitted += Number(budget.count);
    assert(
      admitted <= 100000,
      409,
      'REFERENCE_SCAN_BUDGET_EXCEEDED',
      'Workspace history exceeds the bounded reference scan',
    );
    let cursor = null;
    let visited = 0;
    let sizedCandidates = 0;
    while (true) {
      // Byte-limited prefixes may leave a tail in the sizing window. Refuse
      // pathological dense history before repeated sizing exceeds four visits
      // per admitted row; never trade bounded work for incomplete evidence.
      sizedCandidates += Math.min(1024, Number(budget.count) - visited);
      assert(
        sizedCandidates <= Number(budget.count) * 4,
        409,
        'REFERENCE_SCAN_BUDGET_EXCEEDED',
        'Dense history exceeds the bounded sizing-work budget',
      );
      // Keep only IDs and sizes in the window, then fetch the fitting prefix.
      // Separate first-page SQL preserves empty IDs and indexable cursor ranges.
      const rows = await tx.all(
        `WITH candidates AS (
          SELECT id, ${size} AS stored_bytes FROM ${table} WHERE workspace_id=?${cursor === null ? '' : ' AND id>?'} ORDER BY id LIMIT 1024
        ), bounded AS (
          SELECT id, SUM(stored_bytes) OVER (ORDER BY id ROWS UNBOUNDED PRECEDING) AS page_bytes FROM candidates
        ) SELECT ${columns.join(',')} FROM ${table} WHERE workspace_id=?${cursor === null ? '' : ' AND id>?'} AND id IN (SELECT id FROM bounded WHERE page_bytes<=8000000) ORDER BY id`,
        cursor === null ? [workspace, workspace] : [workspace, cursor, workspace, cursor],
      );
      visited += rows.length;
      assert(
        visited <= Number(budget.count) && (rows.length > 0 || visited === Number(budget.count)),
        409,
        'REFERENCE_SCAN_BUDGET_EXCEEDED',
        'Workspace history changed or contains an oversized row during the bounded reference scan',
      );
      if (!rows.length) break;
      cursor = rows.at(-1).id;
      for (const row of rows) {
        const matches = new Set();
        // SQLite LIKE stops at a raw NUL; PostgreSQL text cannot contain one.
        const text = tx.dialect === 'sqlite' ? row[field].split('\0', 1)[0] : row[field];
        for (const match of text.matchAll(
          /(?=([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}))/gi,
        )) {
          for (const id of candidates.get(key(match[1])) ?? []) matches.add(id);
        }
        if (!matches.size) continue;
        const rowBytes = Buffer.byteLength(canonical(row));
        for (const id of matches) {
          if (exceeded.has(id)) continue;
          const refs = references.get(id);
          bytes.set(id, bytes.get(id) + rowBytes);
          if (refs[table].length === 1000 || bytes.get(id) > 2000000) {
            exceeded.add(id);
            refs.activity = [];
            refs.outbox = [];
          } else refs[table].push(row);
        }
      }
    }
  }
  return { references, exceeded };
}

export async function reconcileLinearComments(tx, actor, input) {
  requirePermission(actor, 'admin');
  const workspace = actor.workspace_id,
    source = input.source_workspace_id;
  assert(
    uuid(source) &&
      Array.isArray(input.source_ids) &&
      input.source_ids.length > 0 &&
      input.source_ids.length <= 50 &&
      input.source_ids.every(uuid) &&
      new Set(input.source_ids).size === input.source_ids.length,
    422,
    'INVALID_RECONCILIATION',
    'Provide an organization and one to fifty distinct source comment UUIDs',
  );
  const sourceIds = [...input.source_ids].sort((a, b) => a.localeCompare(b));
  if (input.plan_hash) {
    assert(
      typeof input.plan_hash === 'string' && /^[a-f0-9]{64}$/.test(input.plan_hash),
      422,
      'INVALID_PLAN',
      'Provide a preview plan hash',
    );
    if (tx.dialect === 'postgres') {
      const isolation = await tx.one('SHOW transaction_isolation');
      assert(
        isolation.transaction_isolation === 'read committed',
        409,
        'UNSUPPORTED_RECONCILIATION_ISOLATION',
        'Apply requires READ COMMITTED with the workspace transaction lock',
      );
    }
    await tx.lock(workspace);
  }
  await assertModule(tx, workspace, 'tickets');
  if (input.plan_hash) {
    const previous = await tx.one(
      'SELECT manifest,result FROM linear_imports WHERE workspace_id=? AND id=? AND status=?',
      [workspace, targetId(workspace, source, operation, input.plan_hash), 'completed'],
    );
    if (previous) {
      const manifest = JSON.parse(previous.manifest);
      assert(
        manifest.operation === operation && canonical(manifest.source_ids) === canonical(sourceIds),
        409,
        'PLAN_CHANGED',
        'Receipt belongs to a different request',
      );
      return { ...JSON.parse(previous.result), unchanged: true };
    }
  }
  const pairs = [],
    ambiguous = [],
    archived = [],
    evidence = [];
  const history = await discoverReferences(tx, workspace, sourceIds);
  const selectedMappings = await tx.all(
    `SELECT m.*,r.payload FROM linear_source_map m JOIN linear_import_records r ON r.workspace_id=m.workspace_id AND r.import_id=m.import_id AND r.collection=m.collection AND r.source_id=m.source_id WHERE m.workspace_id=? AND m.source_workspace_id=? AND m.collection='comments' AND m.source_id IN (${sourceIds.map(() => '?').join(',')}) ORDER BY m.source_id`,
    [workspace, source, ...sourceIds],
  );
  const mappingsBySource = new Map(selectedMappings.map((mapping) => [mapping.source_id, mapping]));
  const targets = [
    ...new Set([...sourceIds, ...selectedMappings.map((mapping) => mapping.target_id)]),
  ];
  // Reverse lookup lacks a target-id index: perform one bounded workspace scan,
  // not a scan for each candidate. Never accept a truncated binding inventory.
  const reverseBindings = await tx.all(
    `SELECT * FROM linear_source_map WHERE workspace_id=? AND collection='comments' AND target_id IN (${targets.map(() => '?').join(',')}) ORDER BY source_workspace_id,source_id LIMIT 1001`,
    [workspace, ...targets],
  );
  assert(
    reverseBindings.length <= 1000,
    409,
    'BINDING_SCAN_BUDGET_EXCEEDED',
    'Too many competing source bindings for a safe repair',
  );
  const bindingsByTarget = new Map();
  for (const binding of reverseBindings) {
    if (!bindingsByTarget.has(binding.target_id)) bindingsByTarget.set(binding.target_id, []);
    bindingsByTarget.get(binding.target_id).push(binding);
  }
  const comments = await tx.all(
    `SELECT * FROM comments WHERE workspace_id=? AND id IN (${targets.map(() => '?').join(',')})`,
    [workspace, ...targets],
  );
  const commentsById = new Map(comments.map((comment) => [comment.id, comment]));
  const records = new Map();
  for (const mapping of selectedMappings) {
    if (
      mapping.target_id !== mapping.source_id &&
      commentsById.has(mapping.source_id) &&
      commentsById.has(mapping.target_id)
    ) {
      const record = JSON.parse(mapping.payload);
      const issueReference = record.issueId ?? record.issue;
      records.set(mapping.source_id, {
        record,
        issueSource: typeof issueReference === 'string' ? issueReference : issueReference?.id,
        authorSource: typeof record.user === 'string' ? record.user : record.user?.id,
      });
    }
  }
  const issueIds = [
    ...new Set([...records.values()].map((item) => item.issueSource).filter((id) => id != null)),
  ];
  const personIds = [
    ...new Set([...records.values()].map((item) => item.authorSource).filter((id) => id != null)),
  ];
  const authorIds = [
    ...new Set(comments.map((comment) => comment.author_id).filter((id) => id != null)),
  ];
  const issues = await tx.all(
    `SELECT source_id,target_id FROM linear_source_map WHERE workspace_id=? AND source_workspace_id=? AND collection='issues' AND source_id IN (${issueIds.map(() => '?').join(',') || 'NULL'})`,
    [workspace, source, ...issueIds],
  );
  const people = await tx.all(
    `SELECT p.* FROM source_people p JOIN linear_source_map m ON m.workspace_id=p.workspace_id AND m.target_id=p.id AND m.collection='users' WHERE m.workspace_id=? AND m.source_workspace_id=? AND m.source_id IN (${personIds.map(() => '?').join(',') || 'NULL'}) AND p.provider='linear' AND p.source_id=m.source_id`,
    [workspace, source, ...personIds],
  );
  const authors = await tx.all(
    `SELECT u.id,u.email FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.workspace_id=? AND u.id IN (${authorIds.map(() => '?').join(',') || 'NULL'})`,
    [workspace, ...authorIds],
  );
  const issuesBySource = new Map(
    issues.map((issue) => [issue.source_id, { target_id: issue.target_id }]),
  );
  const peopleBySource = new Map(people.map((person) => [person.source_id, person]));
  const authorsById = new Map(authors.map((author) => [author.id, { email: author.email }]));
  for (const sourceId of sourceIds) {
    const mapping = mappingsBySource.get(sourceId);
    const mappings = mapping ? [mapping] : [];
    const legacy = commentsById.get(sourceId) ?? null;
    const current = mapping ? (commentsById.get(mapping.target_id) ?? null) : null;
    evidence.push({ sourceId, mappings, legacy, current });
    if (mapping?.target_id === sourceId) continue;
    // Foreign records must be indistinguishable from missing records to this actor.
    // Do not query another workspace merely to explain an absent local comment.
    if (!legacy) continue;
    const reject = (reason) =>
      ambiguous.push({ source_id: sourceId, legacy_id: legacy.id, reason });
    if (!mapping || !current) {
      reject('missing-source-binding');
      continue;
    }
    const { record, issueSource, authorSource } = records.get(sourceId);
    const issue = issuesBySource.get(issueSource) ?? null;
    const person = peopleBySource.get(authorSource) ?? null;
    const nativeAuthor = authorsById.get(legacy.author_id) ?? null;
    const bindings = [
      ...(bindingsByTarget.get(legacy.id) ?? []),
      ...(bindingsByTarget.get(current.id) ?? []),
    ];
    const references = history.references.get(sourceId);
    const archive = { legacy, canonical: current, mapping, references };
    if (
      history.exceeded.has(sourceId) ||
      references.activity.length > 1000 ||
      references.outbox.length > 1000 ||
      Buffer.byteLength(canonical(archive)) > 2000000
    ) {
      reject('archive-budget-exceeded');
      evidence.push({ sourceId, reason: 'archive-budget-exceeded' });
      continue;
    }
    evidence.push({ issue, person, nativeAuthor, bindings, references });
    if (
      record.id !== sourceId ||
      mapping.payload_hash !== digest(record) ||
      !issue ||
      issue.target_id !== current.issue_id ||
      legacy.issue_id !== current.issue_id
    ) {
      reject('issue-or-provenance-mismatch');
      continue;
    }
    if (
      !person ||
      current.author_source_id !== person.id ||
      !(
        legacy.author_source_id === person.id ||
        (!legacy.author_source_id &&
          email(person.email) &&
          email(person.email) === email(nativeAuthor?.email))
      )
    ) {
      reject('author-mismatch');
      continue;
    }
    if (
      !sameTime(current.created_at, record.createdAt) ||
      !sameTime(legacy.created_at, record.createdAt)
    ) {
      reject('creation-time-mismatch');
      continue;
    }
    if (
      typeof record.body !== 'string' ||
      current.body !== record.body ||
      legacy.body !== record.body
    ) {
      reject('content-mismatch');
      continue;
    }
    if (
      bindings.length !== 1 ||
      bindings[0].source_id !== sourceId ||
      bindings[0].source_workspace_id !== source
    ) {
      reject('conflicting-source-binding');
      continue;
    }
    const activeNative = references.outbox.some((row) => {
      const payload = JSON.parse(row.payload);
      return (
        ['pending', 'processing', 'failed', 'blocked'].includes(row.status) &&
        payload.side === 'native' &&
        payload.collection === 'comments' &&
        (payload.targetId === legacy.id || payload.sourceId === legacy.id)
      );
    });
    if (activeNative) {
      reject('pending-native-job');
      continue;
    }
    pairs.push({ source_id: sourceId, canonical_id: current.id, legacy_id: legacy.id });
    archived.push(archive);
  }
  const count = Number(
    (await tx.one('SELECT COUNT(*) AS count FROM comments WHERE workspace_id=?', [workspace]))
      .count,
  );
  const planHash = digest({ operation, workspace, source, sourceIds, evidence, count });
  const id = targetId(workspace, source, operation, planHash);
  const result = {
    id,
    plan_hash: planHash,
    applied: false,
    pairs,
    ambiguous,
    before_count: count,
    after_count: count - pairs.length,
  };
  if (!input.plan_hash) return result;
  assert(
    input.plan_hash === planHash,
    409,
    'PLAN_CHANGED',
    'Evidence changed; preview reconciliation again',
  );
  assert(
    pairs.length > 0,
    409,
    'NO_PROVEN_PAIRS',
    'No safe provenance-linked duplicates to repair',
  );
  const stamp = now();
  const applied = { ...result, applied: true, archived };
  await tx.exec(
    "INSERT INTO linear_imports(id,workspace_id,source_workspace_id,status,manifest,plan_hash,result,created_by,created_at,completed_at) VALUES(?,?,?,'completed',?,?,?,?,?,?)",
    [
      id,
      workspace,
      source,
      canonical({ operation, source_ids: sourceIds }),
      planHash,
      canonical(applied),
      actor.id,
      stamp,
      stamp,
    ],
  );
  for (const item of archived) {
    const removed = await tx.exec(
      'DELETE FROM comments WHERE workspace_id=? AND id=? AND version=?',
      [workspace, item.legacy.id, item.legacy.version],
    );
    assert(
      Number(removed.changes) === 1,
      409,
      'VERSION_CONFLICT',
      'Legacy comment changed concurrently',
    );
    await tx.exec(
      'INSERT INTO activity(id,workspace_id,issue_id,actor_id,action,data,created_at) VALUES(?,?,?,?,?,?,?)',
      [
        targetId(workspace, source, operation, item.legacy.id),
        workspace,
        item.canonical.issue_id,
        actor.id,
        'linear_imported_change',
        canonical({
          commentIdentityReconciled: true,
          receipt_id: id,
          legacy_id: item.legacy.id,
          canonical_id: item.canonical.id,
          sourceId: item.mapping.source_id,
        }),
        stamp,
      ],
    );
  }
  return applied;
}
