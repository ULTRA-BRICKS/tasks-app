import { assert } from '../../core/errors.mjs';
import { canonical, digest, targetId, collections } from '../../../imports/linear-source.mjs';
import { now } from '../../core/crypto.mjs';
import { sourceReferences, TABLES, normalizedSource } from './model.mjs';
const FIELD_GROUPS = {
  team_id: 'teams',
  status_id: 'workflowStates',
  assignee_id: 'users',
  assignee_source_id: 'users',
  creator_source_id: 'users',
  project_id: 'projects',
  cycle_id: 'cycles',
  milestone_id: 'projectMilestones',
  parent_id: 'issues',
  issue_id: 'issues',
  lead_id: 'users',
  lead_source_id: 'users',
  owner_id: 'users',
  owner_source_id: 'users',
  initiative_id: 'initiatives',
};
export async function sourceMapping(tx, config, collection, sourceId) {
  return tx.one(
    'SELECT m.*,r.payload AS original,i.manifest FROM linear_source_map m JOIN linear_import_records r ON r.workspace_id=m.workspace_id AND r.import_id=m.import_id AND r.collection=m.collection AND r.source_id=m.source_id JOIN linear_imports i ON i.workspace_id=m.workspace_id AND i.id=m.import_id WHERE m.workspace_id=? AND m.source_workspace_id=? AND m.collection=? AND m.source_id=?',
    [config.workspaceId, config.organizationId, collection, sourceId],
  );
}
export async function loadNative(tx, config, collection, targetId) {
  assert(TABLES[collection], 422, 'SYNC_MODEL_UNSUPPORTED', 'Unsupported native model');
  const row = await tx.one(
    'SELECT * FROM ' + TABLES[collection] + ' WHERE workspace_id=? AND id=?',
    [config.workspaceId, targetId],
  );
  if (!row) return null;
  if (collection === 'issues')
    row.label_ids = (
      await tx.all(
        'SELECT label_id FROM issue_labels WHERE workspace_id=? AND issue_id=? ORDER BY label_id',
        [config.workspaceId, targetId],
      )
    ).map((x) => x.label_id);
  if (collection === 'projects')
    row.team_ids = (
      await tx.all(
        'SELECT team_id FROM project_teams WHERE workspace_id=? AND project_id=? ORDER BY team_id',
        [config.workspaceId, targetId],
      )
    ).map((x) => x.team_id);
  if (collection === 'initiatives')
    row.project_ids = (
      await tx.all(
        'SELECT project_id FROM initiative_projects WHERE workspace_id=? AND initiative_id=? ORDER BY project_id',
        [config.workspaceId, targetId],
      )
    ).map((x) => x.project_id);
  return row;
}
export function normalizedNative(collection, row, fields) {
  // Related is symmetric. Imported rows can preserve the opposite endpoint order;
  // normalize the view without rewriting identities or directed relationships.
  if (collection === 'issueRelations' && row.type === 'related' && row.source_id > row.target_id)
    row = { ...row, source_id: row.target_id, target_id: row.source_id };
  const result = {};
  for (const field of fields) {
    if (field === 'archived') result[field] = Boolean(row.archived_at);
    else if (field === 'assignee_id')
      result[field] = row.assignee_id ?? row.assignee_source_id ?? null;
    else if (field === 'lead_id') result[field] = row.lead_id ?? row.lead_source_id ?? null;
    else if (field === 'owner_id') result[field] = row.owner_id ?? row.owner_source_id ?? null;
    else result[field] = row[field] ?? null;
  }
  return result;
}
export async function referenceResolver(tx, config, collection, remote, original, native) {
  const sources = new Map(),
    targets = new Map();
  const add = (map, kind, id) => {
    if (!id) return;
    if (!map.has(kind)) map.set(kind, new Set());
    map.get(kind).add(id);
  };
  for (const record of [remote, original].filter(Boolean))
    for (const ref of sourceReferences(collection, record)) add(sources, ref.collection, ref.id);
  for (const [field, kind] of Object.entries(FIELD_GROUPS)) add(targets, kind, native?.[field]);
  for (const id of native?.label_ids ?? []) add(targets, 'issueLabels', id);
  for (const id of native?.team_ids ?? []) add(targets, 'teams', id);
  for (const id of native?.project_ids ?? []) add(targets, 'projects', id);
  const bySource = new Map(),
    byTarget = new Map(),
    labelScopes = new Map();
  for (const kind of new Set([...sources.keys(), ...targets.keys()])) {
    const s = [...(sources.get(kind) ?? [])],
      t = [...(targets.get(kind) ?? [])];
    assert(
      s.length + t.length <= 500,
      422,
      'SYNC_REFERENCE_BUDGET',
      'Too many references in one entity',
    );
    const where = [
      s.length ? 'source_id IN (' + s.map(() => '?').join(',') + ')' : null,
      t.length ? 'target_id IN (' + t.map(() => '?').join(',') + ')' : null,
    ]
      .filter(Boolean)
      .join(' OR ');
    const scopeQuery = kind === 'issueLabels' && collection === 'issues';
    const rows = await tx.all(
      (scopeQuery
        ? 'SELECT source_id,target_id,(SELECT r.payload FROM linear_import_records r WHERE r.workspace_id=linear_source_map.workspace_id AND r.import_id=linear_source_map.import_id AND r.collection=linear_source_map.collection AND r.source_id=linear_source_map.source_id) AS source_payload'
        : 'SELECT source_id,target_id') +
        ' FROM linear_source_map WHERE workspace_id=? AND source_workspace_id=? AND collection=? AND (' +
        where +
        ')',
      [config.workspaceId, config.organizationId, kind, ...s, ...t],
    );
    for (const row of rows) {
      bySource.set(kind + ':' + row.source_id, row.target_id);
      if (scopeQuery) {
        const variants = labelScopes.get(row.target_id) ?? [];
        const record = row.source_payload ? JSON.parse(row.source_payload) : {};
        variants.push({
          id: row.source_id,
          team: record.team,
          archived: Boolean(record.archivedAt),
        });
        labelScopes.set(row.target_id, variants);
      }
      if (!byTarget.has(kind + ':' + row.target_id))
        byTarget.set(kind + ':' + row.target_id, row.source_id);
    }
  }
  const resolve = (kind, id) => {
    const value = bySource.get(kind + ':' + id);
    assert(value, 409, 'SYNC_REFERENCE_PENDING', 'A referenced source entity is not mapped', {
      collection: kind,
      sourceId: id,
    });
    return value;
  };
  const reverse = (kind, id) => {
    if (id === null) return null;
    if (kind === 'issueLabels' && collection === 'issues') {
      const teamId = remote?.team?.id ?? byTarget.get('teams:' + native?.team_id);
      const variants = (labelScopes.get(id) ?? []).filter((label) => !label.archived);
      const teamLabels = variants.filter((label) => teamId && label.team?.id === teamId);
      const candidates = teamLabels.length
        ? teamLabels
        : variants.filter((label) => label.team === null);
      assert(
        candidates.length === 1,
        409,
        candidates.length > 1 ? 'SYNC_SOURCE_ALIAS_AMBIGUOUS' : 'SYNC_LABEL_SCOPE_PENDING',
        'No unique source label is available in this task team',
        { collection: kind, targetId: id, sourceTeamId: teamId ?? null },
      );
      return candidates[0].id;
    }
    const value = byTarget.get(kind + ':' + id);
    assert(value, 409, 'SYNC_REFERENCE_PENDING', 'A native reference is not exported', {
      collection: kind,
      targetId: id,
    });
    return value;
  };
  return { resolve, reverse, bySource, byTarget };
}
export async function registerSource(tx, config, collection, record, target) {
  const stamp = now(),
    runId = targetId(
      config.workspaceId,
      config.organizationId,
      'managed-record',
      collection + ':' + record.id,
    );
  const manifest = {
    format: 'tickets-linear-snapshot-v1',
    operation: 'managed-sync-record',
    organization: { id: config.organizationId },
    verifiedAt: stamp,
    counts: Object.fromEntries(collections.map((c) => [c, c === collection ? 1 : 0])),
  };
  await tx.exec(
    "INSERT INTO linear_imports(id,workspace_id,source_workspace_id,status,manifest,created_by,created_at,completed_at) VALUES(?,?,?,'completed',?,?,?,?) ON CONFLICT(id) DO NOTHING",
    [
      runId,
      config.workspaceId,
      config.organizationId,
      canonical(manifest),
      config.userId,
      stamp,
      stamp,
    ],
  );
  await tx.exec(
    'INSERT INTO linear_import_records(workspace_id,import_id,collection,source_id,payload,payload_hash) VALUES(?,?,?,?,?,?) ON CONFLICT(import_id,collection,source_id) DO NOTHING',
    [config.workspaceId, runId, collection, record.id, canonical(record), digest(record)],
  );
  await tx.exec(
    'INSERT INTO linear_source_map(workspace_id,source_workspace_id,collection,source_id,target_id,payload_hash,import_id) VALUES(?,?,?,?,?,?,?) ON CONFLICT(workspace_id,source_workspace_id,collection,source_id) DO NOTHING',
    [
      config.workspaceId,
      config.organizationId,
      collection,
      record.id,
      target,
      digest(record),
      runId,
    ],
  );
  const result = await sourceMapping(tx, config, collection, record.id);
  assert(
    result.target_id === target,
    409,
    'SYNC_IDENTITY_CONFLICT',
    'A source record is already bound elsewhere',
  );
  return result;
}
export async function contextFor(tx, config, collection, record) {
  const mapping = await sourceMapping(tx, config, collection, record.id),
    native = mapping ? await loadNative(tx, config, collection, mapping.target_id) : null;
  const original = mapping ? JSON.parse(mapping.original) : null;
  const resolver = await referenceResolver(tx, config, collection, record, original, native);
  return {
    mapping,
    native,
    original,
    resolver,
    source: normalizedSource(collection, record, resolver.resolve),
  };
}
