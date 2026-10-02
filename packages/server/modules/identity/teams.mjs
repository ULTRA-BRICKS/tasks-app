import { assert, missing, requirePermission } from '../../core/errors.mjs';
export async function inspectTeam(tx, actor, id) {
  requirePermission(actor, 'read');
  const team = await tx.one('SELECT * FROM teams WHERE workspace_id=? AND id=?', [
    actor.workspace_id,
    id,
  ]);
  if (!team) throw missing('Team');
  const counts = await tx.one(
    'SELECT (SELECT count(*) FROM issues WHERE workspace_id=? AND team_id=?) AS issues,(SELECT count(*) FROM project_teams WHERE workspace_id=? AND team_id=?) AS projects,(SELECT count(*) FROM cycles WHERE workspace_id=? AND team_id=?) AS cycles,(SELECT count(*) FROM teams WHERE workspace_id=?) AS teams',
    [actor.workspace_id, id, actor.workspace_id, id, actor.workspace_id, id, actor.workspace_id],
  );
  const linked = {
    issues: Number(counts.issues),
    projects: Number(counts.projects),
    cycles: Number(counts.cycles),
  };
  return {
    ...team,
    linked,
    can_delete: Number(counts.teams) > 1 && Object.values(linked).every((n) => n === 0),
    last_team: Number(counts.teams) <= 1,
  };
}
export async function renameTeam(tx, actor, id, input) {
  requirePermission(actor, 'admin');
  const current = await inspectTeam(tx, actor, id);
  assert(
    current.name === input.expected_name,
    409,
    'TEAM_CHANGED',
    'This team was renamed elsewhere. Refresh before editing again.',
  );
  const name = input.name.trim();
  assert(
    name.length > 0 && name.length <= 120,
    422,
    'INVALID_TEAM_NAME',
    'Use a team name of 1–120 characters.',
  );
  const result = await tx.exec('UPDATE teams SET name=? WHERE workspace_id=? AND id=? AND name=?', [
    name,
    actor.workspace_id,
    id,
    input.expected_name,
  ]);
  assert(
    Number(result.changes) === 1,
    409,
    'TEAM_CHANGED',
    'This team changed. Refresh before editing again.',
  );
  return { ...current, name };
}
export async function removeEmptyTeam(tx, actor, id, input) {
  requirePermission(actor, 'admin');
  const team = await inspectTeam(tx, actor, id);
  assert(
    input.confirm_key === team.key,
    422,
    'CONFIRM_TEAM_KEY',
    'Type the team key to confirm deletion.',
  );
  assert(!team.last_team, 409, 'LAST_TEAM', 'Keep at least one team in this workspace.');
  assert(
    team.can_delete,
    409,
    'TEAM_NOT_EMPTY',
    'Move the linked issues, projects and cycles before deleting this team. No related data was removed.',
    team.linked,
  );
  await tx.exec('DELETE FROM statuses WHERE workspace_id=? AND team_id=?', [
    actor.workspace_id,
    id,
  ]);
  await tx.exec('DELETE FROM teams WHERE workspace_id=? AND id=?', [actor.workspace_id, id]);
  return { ok: true, id };
}
