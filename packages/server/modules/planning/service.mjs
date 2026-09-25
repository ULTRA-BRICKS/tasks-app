import { resolvePerson } from '../../core/source-people.mjs';
import { id, now } from '../../core/crypto.mjs';
import { assert, missing, conflict, requirePermission } from '../../core/errors.mjs';
import { assertModule } from '../../core/modules.mjs';

export async function listProjects(tx, actor) {
  await assertModule(tx, actor.workspace_id, 'planning');
  const projects = await tx.all(
    'SELECT * FROM projects WHERE workspace_id=? AND archived_at IS NULL ORDER BY created_at DESC',
    [actor.workspace_id],
  );
  const totals = await tx.all(
    "SELECT i.project_id,COUNT(*) AS total,SUM(CASE WHEN s.category='completed' THEN 1 ELSE 0 END) AS completed FROM issues i JOIN statuses s ON s.id=i.status_id WHERE i.workspace_id=? AND i.project_id IS NOT NULL AND i.kind='issue' AND i.deleted_at IS NULL AND i.archived_at IS NULL AND s.category<>'canceled' GROUP BY i.project_id",
    [actor.workspace_id],
  );
  const teams = await tx.all('SELECT project_id,team_id FROM project_teams WHERE workspace_id=?', [
    actor.workspace_id,
  ]);
  const totalsByProject = new Map(totals.map((t) => [t.project_id, t]));
  const teamsByProject = new Map();
  for (const t of teams) {
    if (!teamsByProject.has(t.project_id)) teamsByProject.set(t.project_id, []);
    teamsByProject.get(t.project_id).push(t.team_id);
  }
  return projects.map((p) => ({
    ...p,
    lead_id: p.lead_id ?? p.lead_source_id,
    total: Number(totalsByProject.get(p.id)?.total ?? 0),
    completed: Number(totalsByProject.get(p.id)?.completed ?? 0),
    team_ids: teamsByProject.get(p.id) ?? [],
  }));
}
async function checkProject(tx, actor, input) {
  assert(
    typeof input.name === 'string' && input.name.trim(),
    422,
    'NAME_REQUIRED',
    'Give this project a name',
  );
  assert(
    !input.start_date || !input.target_date || input.start_date <= input.target_date,
    422,
    'INVALID_DATES',
    'Target date must not precede start date',
  );
  const lead = await resolvePerson(tx, actor, input.lead_id ?? input.lead_source_id);
  input.lead_id = lead.member;
  input.lead_source_id = lead.source;
}
export async function createProject(tx, actor, input) {
  requirePermission(actor, 'write');
  await assertModule(tx, actor.workspace_id, 'planning');
  await checkProject(tx, actor, input);
  assert(input.team_ids.length > 0, 422, 'TEAMS_REQUIRED', 'Choose at least one team');
  for (const teamId of input.team_ids)
    assert(
      await tx.one('SELECT id FROM teams WHERE workspace_id=? AND id=?', [
        actor.workspace_id,
        teamId,
      ]),
      422,
      'INVALID_TEAM',
      'Team not found',
    );
  const created = now(),
    project = {
      id: id(),
      workspace_id: actor.workspace_id,
      name: input.name.trim(),
      description: input.description ?? '',
      status: input.status ?? 'planned',
      health: input.health ?? 'on_track',
      lead_id: input.lead_id ?? null,
      lead_source_id: input.lead_source_id ?? null,
      start_date: input.start_date ?? null,
      target_date: input.target_date ?? null,
      version: 1,
      created_at: created,
      updated_at: created,
      archived_at: null,
    };
  await tx.exec(
    `INSERT INTO projects(${Object.keys(project).join(',')}) VALUES(${Object.keys(project)
      .map(() => '?')
      .join(',')})`,
    Object.values(project),
  );
  for (const team of input.team_ids)
    await tx.exec('INSERT INTO project_teams(workspace_id,project_id,team_id) VALUES(?,?,?)', [
      actor.workspace_id,
      project.id,
      team,
    ]);
  return { ...project, team_ids: input.team_ids };
}
export async function updateProject(tx, actor, projectId, input) {
  requirePermission(actor, 'write');
  await assertModule(tx, actor.workspace_id, 'planning');
  const current = await tx.one('SELECT * FROM projects WHERE workspace_id=? AND id=?', [
    actor.workspace_id,
    projectId,
  ]);
  if (!current) throw missing('Project');
  if (input.version !== current.version) conflict(current);
  let teamIds;
  if (Object.hasOwn(input, 'team_ids')) {
    assert(Array.isArray(input.team_ids) && input.team_ids.length>0 && input.team_ids.length<=100,422,'TEAMS_REQUIRED','Choose one to100 teams');
    teamIds=[...new Set(input.team_ids)];
    const teams=await tx.all(`SELECT id FROM teams WHERE workspace_id=? AND id IN (${teamIds.map(()=>'?').join(',')})`,[actor.workspace_id,...teamIds]);
    assert(teams.length===teamIds.length,422,'INVALID_TEAM','Every project team must belong to this workspace');
  }
  const fields = [
    'name',
    'description',
    'status',
    'health',
    'lead_id',
    'start_date',
    'target_date',
  ];
  const next = { ...current };
  for (const f of fields) if (Object.hasOwn(input, f)) next[f] = input[f];
  if (Object.hasOwn(input, 'lead_id')) next.lead_source_id = null;
  await checkProject(tx, actor, next);
  fields.push('lead_source_id');
  if (Object.hasOwn(input, 'archived')) next.archived_at = input.archived ? now() : null;
  const changed=await tx.exec(
    `UPDATE projects SET ${fields.map((f) => f + '=?').join(',')},archived_at=?,version=version+1,updated_at=? WHERE workspace_id=? AND id=? AND version=?`,
    [...fields.map((f) => next[f]), next.archived_at, now(), actor.workspace_id, projectId,current.version],
  );
  if(Number(changed.changes)!==1)conflict(await tx.one('SELECT * FROM projects WHERE workspace_id=? AND id=?',[actor.workspace_id,projectId]));
  if(teamIds){
    await tx.exec('DELETE FROM project_teams WHERE workspace_id=? AND project_id=?',[actor.workspace_id,projectId]);
    for(const team of teamIds)await tx.exec('INSERT INTO project_teams(workspace_id,project_id,team_id) VALUES(?,?,?)',[actor.workspace_id,projectId,team]);
  }
  return { ...next, version: current.version + 1,...(teamIds?{team_ids:teamIds}:{}) };
}
export async function createMilestone(tx, actor, input) {
  requirePermission(actor, 'write');
  await assertModule(tx, actor.workspace_id, 'planning');
  assert(
    await tx.one('SELECT id FROM projects WHERE workspace_id=? AND id=?', [
      actor.workspace_id,
      input.project_id,
    ]),
    422,
    'INVALID_PROJECT',
    'Project not found',
  );
  const result = {
    id: id(),
    workspace_id: actor.workspace_id,
    project_id: input.project_id,
    name: input.name.trim(),
    target_date: input.target_date ?? null,
    position: Date.now(),
  };
  await tx.exec(
    'INSERT INTO milestones(id,workspace_id,project_id,name,target_date,position) VALUES(?,?,?,?,?,?)',
    Object.values(result),
  );
  return result;
}
export async function createCycle(tx, actor, input) {
  assert(input.name.trim(), 422, 'NAME_REQUIRED', 'Give this cycle a name');
  requirePermission(actor, 'write');
  await assertModule(tx, actor.workspace_id, 'cycles');
  assert(
    input.start_date <= input.end_date,
    422,
    'INVALID_DATES',
    'End date must not precede start date',
  );
  assert(
    await tx.one('SELECT id FROM teams WHERE workspace_id=? AND id=?', [
      actor.workspace_id,
      input.team_id,
    ]),
    422,
    'INVALID_TEAM',
    'Team not found',
  );
  const result = {
    id: id(),
    workspace_id: actor.workspace_id,
    team_id: input.team_id,
    name: input.name.trim(),
    start_date: input.start_date,
    end_date: input.end_date,
    version: 1,
  };
  await tx.exec(
    'INSERT INTO cycles(id,workspace_id,team_id,name,start_date,end_date,version) VALUES(?,?,?,?,?,?,?)',
    Object.values(result),
  );
  return result;
}

export async function updateCycle(tx, actor, cycleId, input) {
  requirePermission(actor, 'write');
  await assertModule(tx, actor.workspace_id, 'cycles');
  const current = await tx.one('SELECT * FROM cycles WHERE workspace_id=? AND id=?', [
    actor.workspace_id,
    cycleId,
  ]);
  if (!current) throw missing('Cycle');
  if (current.version !== input.version) conflict(current);
  const next = { ...current };
  for (const key of ['name', 'start_date', 'end_date'])
    if (Object.hasOwn(input, key)) next[key] = input[key];
  next.name = next.name.trim();
  assert(next.name, 422, 'NAME_REQUIRED', 'Give this cycle a name');
  assert(
    next.start_date <= next.end_date,
    422,
    'INVALID_DATES',
    'End date must not precede start date',
  );
  await tx.exec(
    'UPDATE cycles SET name=?,start_date=?,end_date=?,version=version+1 WHERE workspace_id=? AND id=?',
    [next.name, next.start_date, next.end_date, actor.workspace_id, cycleId],
  );
  return { ...next, version: current.version + 1 };
}
