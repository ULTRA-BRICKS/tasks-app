import { readEntityState } from './store.mjs';
import { TABLES } from './model.mjs';
import { uuid } from '../../../imports/linear-source.mjs';
import { assert } from '../../core/errors.mjs';
import { readSourceEntity } from './client.mjs';
export async function sourceInScope(db, env, config, collection, record, options = {}, depth = 0) {
  assert(
    depth < 8,
    422,
    'SYNC_SCOPE_DEPTH',
    'Source ownership cannot be resolved within the scope budget',
  );
  const allowed = new Set(config.teamIds);
  if (collection === 'teams') return allowed.has(record.id);
  if (record.team?.id) return allowed.has(record.team.id);
  if (record.teams?.nodes) return record.teams.nodes.some((team) => allowed.has(team.id));
  for (const [field, kind] of [
    ['issue', 'issues'],
    ['project', 'projects'],
  ])
    if (record[field]?.id) {
      const child = await readSourceEntity(env, kind, record[field].id, options);
      assert(child, 409, 'SYNC_SCOPE_UNAVAILABLE', 'Parent source identity is unavailable');
      return sourceInScope(db, env, config, kind, child, options, depth + 1);
    }
  // Workspace-wide documents, initiatives and people are intentionally shared; team-bound records above are constrained.
  return true;
}
export async function nativeInScope(tx, config, collection, row) {
  if (!row) return false;
  const disposition = await readEntityState(tx, config.workspaceId, collection, row.id);
  if (disposition?.resolution === 'operator-duplicate-resolution' && disposition.supersededBy) {
    assert(
      TABLES[collection] && uuid(disposition.supersededBy) && disposition.supersededBy !== row.id,
      409,
      'SYNC_ALIAS_INVALID',
      'Invalid duplicate-resolution identity',
    );
    const canonical = await tx.one(
      'SELECT id FROM ' + TABLES[collection] + ' WHERE workspace_id=? AND id=?',
      [config.workspaceId, disposition.supersededBy],
    );
    assert(
      canonical,
      409,
      'SYNC_ALIAS_INVALID',
      'Resolved duplicate target is not in this workspace',
    );
    return false;
  }
  const ids = row.team_id ? [row.team_id] : (row.team_ids ?? []);
  if (!ids.length && collection === 'comments') {
    const issue = await tx.one('SELECT team_id FROM issues WHERE workspace_id=? AND id=?', [
      config.workspaceId,
      row.issue_id,
    ]);
    assert(issue, 409, 'SYNC_SCOPE_UNAVAILABLE', 'Native comment parent is unavailable');
    ids.push(issue.team_id);
  }
  if (!ids.length) return true;
  const teams = await tx.all(
    `SELECT source_id FROM linear_source_map WHERE workspace_id=? AND source_workspace_id=? AND collection='teams' AND target_id IN (${ids.map(() => '?').join(',')})`,
    [config.workspaceId, config.organizationId, ...ids],
  );
  return teams.some((team) => config.teamIds.includes(team.source_id));
}
