import { queueNativeLinearChange } from '../../core/linear-events.mjs';
import { id, now } from '../../core/crypto.mjs';
import { assert, missing, conflict, requirePermission } from '../../core/errors.mjs';
import { assertModule } from '../../core/modules.mjs';
import { resolvePerson } from '../../core/source-people.mjs';
const tables = new Set(['documents', 'initiatives']);
function tableFor(kind) {
  assert(tables.has(kind), 404, 'NOT_FOUND', 'Unknown knowledge type');
  return kind;
}
async function projectRefs(tx, actor, ids) {
  for (const value of ids)
    if (value)
      assert(
        await tx.one('SELECT id FROM projects WHERE workspace_id=? AND id=?', [
          actor.workspace_id,
          value,
        ]),
        422,
        'INVALID_PROJECT',
        'Project does not belong to this workspace',
      );
}
export async function getKnowledge(tx, actor, kind, key) {
  requirePermission(actor, 'read');
  await assertModule(tx, actor.workspace_id, 'planning');
  const row = await tx.one(`SELECT * FROM ${tableFor(kind)} WHERE workspace_id=? AND id=?`, [
    actor.workspace_id,
    key,
  ]);
  if (!row) throw missing(kind === 'documents' ? 'Document' : 'Initiative');
  if (kind === 'initiatives')
    row.project_ids = (
      await tx.all(
        'SELECT project_id FROM initiative_projects WHERE workspace_id=? AND initiative_id=? ORDER BY project_id',
        [actor.workspace_id, key],
      )
    ).map((x) => x.project_id);
  return row;
}
export async function listKnowledge(tx, actor, kind, includeArchived = false) {
  requirePermission(actor, 'read');
  await assertModule(tx, actor.workspace_id, 'planning');
  return tx.all(
    `SELECT * FROM ${tableFor(kind)} WHERE workspace_id=? ${includeArchived ? '' : 'AND archived_at IS NULL'} ORDER BY updated_at DESC,id`,
    [actor.workspace_id],
  );
}
async function validate(tx, actor, kind, input) {
  const heading = kind === 'documents' ? input.title : input.name;
  assert(
    typeof heading === 'string' && heading.trim().length > 0,
    422,
    'NAME_REQUIRED',
    'Give this object a name',
  );
  if (kind === 'documents') {
    await projectRefs(tx, actor, [input.project_id]);
    if (input.initiative_id) await getKnowledge(tx, actor, 'initiatives', input.initiative_id);
  } else await projectRefs(tx, actor, input.project_ids ?? []);
}
export async function createKnowledge(tx, actor, kind, input) {
  requirePermission(actor, 'write');
  await assertModule(tx, actor.workspace_id, 'planning');
  await validate(tx, actor, kind, input);
  const created = now(),
    row = {
      id: id(),
      workspace_id: actor.workspace_id,
      version: 1,
      created_at: created,
      updated_at: created,
      archived_at: null,
    };
  if (kind === 'documents')
    Object.assign(row, {
      title: input.title.trim(),
      body: input.body ?? '',
      project_id: input.project_id ?? null,
      initiative_id: input.initiative_id ?? null,
      creator_id: actor.id,
      creator_source_id: null,
    });
  else {
    const owner = await resolvePerson(tx, actor, input.owner_id ?? null);
    Object.assign(row, {
      name: input.name.trim(),
      description: input.description ?? '',
      status: input.status ?? 'planned',
      target_date: input.target_date ?? null,
      owner_id: owner.member,
      owner_source_id: owner.source,
    });
  }
  await tx.exec(
    `INSERT INTO ${tableFor(kind)}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row)
      .map(() => '?')
      .join(',')})`,
    Object.values(row),
  );
  if (kind === 'initiatives')
    for (const project of input.project_ids ?? [])
      await tx.exec(
        'INSERT INTO initiative_projects(workspace_id,initiative_id,project_id) VALUES(?,?,?)',
        [actor.workspace_id, row.id, project],
      );
  await queueNativeLinearChange(tx, actor, kind, row.id, row.version);
  return getKnowledge(tx, actor, kind, row.id);
}
export async function updateKnowledge(tx, actor, kind, key, input) {
  requirePermission(actor, 'write');
  const row = await getKnowledge(tx, actor, kind, key);
  if (input.version !== row.version) conflict(row);
  const fields =
    kind === 'documents'
      ? ['title', 'body', 'project_id', 'initiative_id']
      : ['name', 'description', 'status', 'target_date', 'owner_id', 'owner_source_id'];
  const next = { ...row };
  for (const field of fields)
    if (field !== 'owner_source_id' && Object.hasOwn(input, field)) next[field] = input[field];
  if (kind === 'initiatives' && Object.hasOwn(input, 'owner_id')) {
    const owner = await resolvePerson(tx, actor, input.owner_id);
    next.owner_id = owner.member;
    next.owner_source_id = owner.source;
  }
  if (Object.hasOwn(input, 'project_ids')) next.project_ids = input.project_ids;
  await validate(tx, actor, kind, next);
  next.archived_at = Object.hasOwn(input, 'archived')
    ? input.archived
      ? (row.archived_at ?? now())
      : null
    : row.archived_at;
  const changed = await tx.exec(
    `UPDATE ${tableFor(kind)} SET ${fields.map((f) => f + '=?').join(',')},archived_at=?,updated_at=?,version=version+1 WHERE workspace_id=? AND id=? AND version=?`,
    [
      ...fields.map((f) => next[f]),
      next.archived_at,
      now(),
      actor.workspace_id,
      key,
      input.version,
    ],
  );
  if (Number(changed.changes) !== 1) conflict(await getKnowledge(tx, actor, kind, key));
  if (kind === 'initiatives' && Object.hasOwn(input, 'project_ids')) {
    await tx.exec('DELETE FROM initiative_projects WHERE workspace_id=? AND initiative_id=?', [
      actor.workspace_id,
      key,
    ]);
    for (const project of input.project_ids)
      await tx.exec(
        'INSERT INTO initiative_projects(workspace_id,initiative_id,project_id) VALUES(?,?,?)',
        [actor.workspace_id, key, project],
      );
  }
  await queueNativeLinearChange(tx, actor, kind, key, row.version + 1);
  return getKnowledge(tx, actor, kind, key);
}
