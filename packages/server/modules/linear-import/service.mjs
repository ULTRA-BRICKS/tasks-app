import { prepareFiles, fileStamp } from './files.mjs';
import { id, now } from '../../core/crypto.mjs';
import { assert, missing, requirePermission } from '../../core/errors.mjs';
import {
  collections,
  canonical,
  digest,
  uuid,
  targetId,
  validateManifest,
} from '../../../imports/linear-source.mjs';
import { projectSnapshot } from '../../../imports/linear-projection.mjs';
const nativeTables = new Set([
  'source_people',
  'teams',
  'statuses',
  'labels',
  'projects',
  'project_teams',
  'milestones',
  'cycles',
  'initiatives',
  'initiative_projects',
  'issues',
  'issue_labels',
  'relations',
  'external_links',
  'documents',
  'comments',
  'activity',
]);
export async function getImport(tx, actor, key) {
  requirePermission(actor, 'admin');
  const run = await tx.one('SELECT * FROM linear_imports WHERE workspace_id=? AND id=?', [
    actor.workspace_id,
    key,
  ]);
  if (!run) throw missing('Import');
  return run;
}
export async function createImport(tx, actor, manifest) {
  requirePermission(actor, 'admin');
  try {
    validateManifest(manifest);
  } catch (error) {
    assert(false, 422, 'INVALID_SNAPSHOT', error.message);
  }
  const serialized = canonical(manifest);
  const previous = await tx.one(
    'SELECT id,status FROM linear_imports WHERE workspace_id=? AND source_workspace_id=? AND manifest=? ORDER BY created_at LIMIT 1',
    [actor.workspace_id, manifest.organization.id, serialized],
  );
  if (previous) return previous;
  const run = {
    id: id(),
    workspace_id: actor.workspace_id,
    source_workspace_id: manifest.organization.id,
    status: 'staging',
    manifest: serialized,
    created_by: actor.id,
    created_at: now(),
  };
  await tx.exec(
    'INSERT INTO linear_imports(id,workspace_id,source_workspace_id,status,manifest,created_by,created_at) VALUES(?,?,?,?,?,?,?)',
    Object.values(run),
  );
  return { id: run.id, status: run.status };
}
export async function stageRecords(tx, actor, key, collection, records) {
  requirePermission(actor, 'admin');
  await tx.lock(actor.workspace_id + ':linear-import:' + key);
  const run = await getImport(tx, actor, key);
  assert(
    collections.includes(collection) &&
      Array.isArray(records) &&
      records.length > 0 &&
      records.length <= 100,
    422,
    'INVALID_BATCH',
    'Use a supported source collection and 1–100 records',
  );
  assert(
    records.every((record) => record && uuid(record.id)) &&
      new Set(records.map((r) => r.id)).size === records.length,
    422,
    'INVALID_SOURCE_ID',
    'Source UUIDs must be valid and unique within a batch',
  );
  const previous = await tx.all(
    `SELECT source_id,payload_hash FROM linear_import_records WHERE workspace_id=? AND import_id=? AND collection=? AND source_id IN (${records.map(() => '?').join(',')})`,
    [actor.workspace_id, key, collection, ...records.map((r) => r.id)],
  );
  const hashes = new Map(previous.map((r) => [r.source_id, r.payload_hash])),
    fresh = [];
  let unchanged = 0;
  for (const record of records) {
    const payload = canonical(record),
      hash = digest(record);
    assert(
      payload.length <= 1000000,
      413,
      'SOURCE_RECORD_TOO_LARGE',
      'Source record exceeds the import budget',
    );
    if (hashes.has(record.id)) {
      assert(
        hashes.get(record.id) === hash,
        409,
        'SOURCE_RECORD_CONFLICT',
        'Source changed; create a new snapshot instead of overwriting staged data',
      );
      unchanged++;
      continue;
    }
    assert(
      run.status === 'staging',
      409,
      'IMPORT_FROZEN',
      'A planned import cannot accept new records',
    );
    fresh.push([actor.workspace_id, key, collection, record.id, payload, hash]);
  }
  if (fresh.length)
    await tx.exec(
      `INSERT INTO linear_import_records(workspace_id,import_id,collection,source_id,payload,payload_hash) VALUES ${fresh.map(() => '(?,?,?,?,?,?)').join(',')}`,
      fresh.flat(),
    );
  const count = await tx.one(
    'SELECT COUNT(*) AS n FROM linear_import_records WHERE workspace_id=? AND import_id=? AND collection=?',
    [actor.workspace_id, key, collection],
  );
  assert(
    Number(count.n) <= JSON.parse(run.manifest).counts[collection],
    409,
    'EXCESS_SOURCE_RECORDS',
    'Batch exceeds the declared source count',
  );
  const size = await tx.one(
    'SELECT COALESCE(SUM(length(payload)),0) AS size FROM linear_import_records WHERE workspace_id=? AND import_id=?',
    [actor.workspace_id, key],
  );
  assert(
    Number(size.size) <= 64 * 1024 * 1024,
    413,
    'IMPORT_STORAGE_BUDGET',
    'Snapshot exceeds the bounded storage budget',
  );
  return { inserted: fresh.length, unchanged };
}

async function projection(tx, actor, run) {
  const stored = await tx.all(
    'SELECT collection,payload FROM linear_import_records WHERE workspace_id=? AND import_id=? ORDER BY collection,source_id',
    [actor.workspace_id, run.id],
  );
  const data = Object.fromEntries(collections.map((c) => [c, []])),
    manifest = JSON.parse(run.manifest);
  for (const record of stored) data[record.collection].push(JSON.parse(record.payload));
  assert(
    collections.every((c) => data[c].length === manifest.counts[c]),
    409,
    'INCOMPLETE_SNAPSHOT',
    'All declared source collections must be staged before planning',
  );
  assert(
    new Set(data.issueLabels.map((label) => label.name)).size === data.issueLabels.length,
    422,
    'AMBIGUOUS_SOURCE_LABELS',
    'Different source labels share a name. An explicit disambiguation map is required; no source labels are merged or application records written.',
  );
  try {
    const labels = await tx.all('SELECT id,name,color FROM labels WHERE workspace_id=?', [
      actor.workspace_id,
    ]);
    const labelTargets = Object.fromEntries(
      data.issueLabels.flatMap((label) => {
        const target = labels.find(
          (x) =>
            x.name === label.name &&
            x.id !== targetId(actor.workspace_id, run.source_workspace_id, 'issueLabels', label.id),
        );
        return target ? [[label.id, target]] : [];
      }),
    );
    return projectSnapshot({ data, manifest }, { ...actor, id: run.created_by }, { labelTargets });
  } catch (error) {
    assert(false, 422, 'UNREPRESENTABLE_SOURCE', error.message);
  }
}
async function checkExisting(tx, actor, run, plan) {
  const existing = await tx.all(
    'SELECT collection,source_id,payload_hash FROM linear_source_map WHERE workspace_id=? AND source_workspace_id=?',
    [actor.workspace_id, run.source_workspace_id],
  );
  if (existing.length) {
    const hashes = new Map(existing.map((x) => [x.collection + ':' + x.source_id, x.payload_hash]));
    assert(
      existing.length === plan.mappings.length &&
        plan.mappings.every((x) => hashes.get(x.collection + ':' + x.source_id) === x.payload_hash),
      409,
      'SOURCE_CHANGED_AFTER_IMPORT',
      'An earlier source import exists. Reconciliation is required; existing Tasks edits will not be overwritten.',
    );
    return true;
  }
  const teams = await tx.all('SELECT key FROM teams WHERE workspace_id=?', [actor.workspace_id]);
  const labels = await tx.all('SELECT name FROM labels WHERE workspace_id=?', [actor.workspace_id]);
  const conflicts = plan.rows
    .filter(
      (x) =>
        (x.table === 'teams' && teams.some((t) => t.key === x.row.key)) ||
        (x.table === 'labels' && labels.some((l) => l.name === x.row.name)),
    )
    .map((x) => ({ type: x.table, name: x.row.name }));
  assert(
    !conflicts.length,
    409,
    'TARGET_NAME_CONFLICT',
    'Existing team/label names require an explicit mapping; no destination data was changed',
    conflicts,
  );
  return false;
}
export async function planImport(tx, actor, key) {
  requirePermission(actor, 'admin');
  await tx.lock(actor.workspace_id + ':linear-import:' + key);
  const run = await getImport(tx, actor, key);
  if (run.status === 'completed') return JSON.parse(run.result);
  const plan = await projection(tx, actor, run),
    alreadyApplied = await checkExisting(tx, actor, run, plan);
  const files = await prepareFiles(tx, actor, run, plan.privateAssets);
  const planHash = digest({ projection: plan.hash, files: fileStamp(files) });
  await tx.exec(
    "UPDATE linear_imports SET status='planned',plan_hash=? WHERE workspace_id=? AND id=?",
    [planHash, actor.workspace_id, key],
  );
  return {
    id: key,
    status: 'planned',
    plan_hash: planHash,
    counts: plan.counts,
    reused_labels: plan.reusedLabels,
    source_records: plan.mappings.length,
    files: files.map(({ id, source_url, source_hash, status, sha256, bytes, source_status }) => ({
      id,
      source_url,
      source_hash,
      status,
      sha256,
      bytes,
      source_status,
    })),
    private_files_pending: files.filter((file) => file.status === 'pending').length,
    source_files_unavailable: files.filter((file) => file.status === 'source_unavailable').length,
    safe_to_apply: files.every((file) => file.status === 'ready'),
    already_applied: alreadyApplied,
    warnings: plan.warnings,
  };
}
async function insertRows(tx, table, rows) {
  assert(
    nativeTables.has(table) || table === 'linear_source_map',
    500,
    'INVALID_IMPORT_TABLE',
    'Unexpected import table',
  );
  for (let start = 0; start < rows.length; start += 100) {
    const batch = rows.slice(start, start + 100),
      columns = Object.keys(batch[0]);
    assert(
      columns.every((c) => /^[a-z_]+$/.test(c)) &&
        batch.every((r) => Object.keys(r).join(',') === columns.join(',')),
      500,
      'INVALID_IMPORT_ROW',
      'Inconsistent row shape',
    );
    await tx.exec(
      `INSERT INTO ${table}(${columns.join(',')}) VALUES ${batch.map(() => '(' + columns.map(() => '?').join(',') + ')').join(',')}`,
      batch.flatMap((r) => columns.map((c) => r[c])),
    );
  }
}
export async function applyImport(
  tx,
  actor,
  key,
  planHash,
  { rehearsal = false, acceptMissing = false } = {},
) {
  requirePermission(actor, 'admin');
  await tx.lock(actor.workspace_id + ':linear-import:' + key);
  const run = await getImport(tx, actor, key);
  if (run.status === 'completed') return JSON.parse(run.result);
  assert(
    run.status === 'planned' && run.plan_hash === planHash,
    409,
    'PLAN_REQUIRED',
    'Approve the exact current import plan before applying',
  );
  const plan = await projection(tx, actor, run);
  const files = await prepareFiles(tx, actor, run, plan.privateAssets);
  assert(
    digest({ projection: plan.hash, files: fileStamp(files) }) === planHash,
    409,
    'PLAN_CHANGED',
    'The source or file verification plan changed',
  );
  // Projection is guarded by the import lock; serialize only the final native write phase.
  await tx.lock(actor.workspace_id);
  const alreadyApplied = await checkExisting(tx, actor, run, plan);
  assert(
    rehearsal || files.every((file) => file.status !== 'pending'),
    409,
    'PRIVATE_FILES_PENDING',
    'Private file bytes must be transferred and verified before production import',
  );
  assert(
    plan.rows.every((x) => nativeTables.has(x.table)),
    500,
    'UNSUPPORTED_PROJECTION',
    'Every projected table must have an explicit apply handler',
  );
  const missingFiles = files.filter((file) => file.status === 'source_unavailable');
  assert(
    rehearsal || acceptMissing || missingFiles.length === 0,
    409,
    'SOURCE_MISSING_CONFIRMATION',
    'Explicit confirmation of the listed missing source files is required. Source references are never discarded.',
  );
  if (!alreadyApplied) {
    for (const table of nativeTables)
      await insertRows(
        tx,
        table,
        plan.rows.filter((x) => x.table === table).map((x) => x.row),
      );
    await insertRows(
      tx,
      'linear_source_map',
      plan.mappings.map((x) => ({
        workspace_id: actor.workspace_id,
        source_workspace_id: run.source_workspace_id,
        ...x,
        import_id: key,
      })),
    );
  }
  const result = {
    id: key,
    status: 'completed',
    plan_hash: planHash,
    counts: plan.counts,
    reused_labels: plan.reusedLabels,
    source_records: plan.mappings.length,
    already_applied: alreadyApplied,
    mode: rehearsal ? 'rehearsal' : 'verified',
    private_files_pending: files.filter((file) => file.status === 'pending').length,
    source_files_unavailable: missingFiles.map((file) => ({
      source_hash: file.source_hash,
      status: file.source_status,
    })),
    warnings: plan.warnings,
  };
  await tx.exec(
    "UPDATE linear_imports SET status='completed',result=?,completed_at=? WHERE workspace_id=? AND id=?",
    [canonical(result), now(), actor.workspace_id, key],
  );
  return result;
}
export async function importStatus(tx, actor, key) {
  const run = await getImport(tx, actor, key);
  const counts = await tx.all(
    'SELECT collection,COUNT(*) AS count FROM linear_import_records WHERE workspace_id=? AND import_id=? GROUP BY collection',
    [actor.workspace_id, key],
  );
  return {
    id: run.id,
    status: run.status,
    source_workspace_id: run.source_workspace_id,
    counts,
    plan_hash: run.plan_hash,
    result: run.result ? JSON.parse(run.result) : null,
  };
}
export async function sourceRecord(tx, actor, collection, sourceId) {
  requirePermission(actor, ['users', 'teamMembers'].includes(collection) ? 'admin' : 'read');
  assert(collections.includes(collection), 404, 'NOT_FOUND', 'Unknown source collection');
  const row = await tx.one(
    "SELECT r.payload FROM linear_import_records r JOIN linear_imports i ON i.id=r.import_id AND i.workspace_id=r.workspace_id WHERE r.workspace_id=? AND r.collection=? AND r.source_id=? AND i.status='completed' ORDER BY i.completed_at DESC LIMIT 1",
    [actor.workspace_id, collection, sourceId],
  );
  if (!row) throw missing('Imported source record');
  return JSON.parse(row.payload);
}
