import { assert, missing, requirePermission } from '../../core/errors.mjs';
import { id, now } from '../../core/crypto.mjs';
import { assertModule } from '../../core/modules.mjs';
const targets = Object.freeze({
  issue: {
    table: 'issues',
    title: 'title',
    path: '/issues/',
    where: ' AND deleted_at IS NULL',
    module: 'tickets',
  },
  project: { table: 'projects', title: 'name', path: '/projects/', module: 'planning' },
  document: { table: 'documents', title: 'title', path: '/documents/', module: 'planning' },
  initiative: { table: 'initiatives', title: 'name', path: '/initiatives/', module: 'planning' },
  cycle: { table: 'cycles', title: 'name', path: '/cycles/', module: 'cycles' },
  customView: { table: 'saved_views', title: 'name', path: '/issues?', module: 'views' },
  label: { table: 'labels', title: 'name', path: '/issues?label_id=', module: 'tickets' },
  team: { table: 'teams', title: 'name', path: '/issues?team_id=', module: 'tickets' },
});
async function resolveTargets(tx, actor, type, ids) {
  const spec = targets[type];
  assert(spec, 422, 'INVALID_FAVORITE', 'Unsupported favorite target');
  const found = [];
  for (let start = 0; start < ids.length; start += 100) {
    const chunk = ids.slice(start, start + 100),
      args = [actor.workspace_id, ...chunk];
    const privacy = type === 'customView' ? ' AND (owner_id=? OR shared=1)' : '';
    if (privacy) args.push(actor.id);
    found.push(
      ...(await tx.all(
        'SELECT id,' +
          spec.title +
          ' AS title' +
          (type === 'customView' ? ',filters' : '') +
          ' FROM ' +
          spec.table +
          ' WHERE workspace_id=? AND id IN (' +
          chunk.map(() => '?').join(',') +
          ')' +
          (spec.where ?? '') +
          privacy,
        args,
      )),
    );
  }
  return new Map(
    found.map((row) => [
      row.id,
      {
        title: row.title,
        href:
          type === 'customView'
            ? spec.path +
              new URLSearchParams(
                Object.entries(JSON.parse(row.filters)).map(([k, v]) => [k, String(v)]),
              )
            : spec.path + encodeURIComponent(row.id),
      },
    ]),
  );
}
export async function listFavorites(tx, actor) {
  requirePermission(actor, 'read');
  await assertModule(tx, actor.workspace_id, 'views');
  const rows = await tx.all(
    'SELECT * FROM favorites WHERE workspace_id=? AND owner_id=? AND archived_at IS NULL ORDER BY sort_order,id',
    [actor.workspace_id, actor.id],
  );
  const disabled = new Set(
    (
      await tx.all('SELECT module FROM module_settings WHERE workspace_id=? AND enabled=0', [
        actor.workspace_id,
      ])
    ).map((x) => x.module),
  );
  const resolved = new Map();
  for (const type of new Set(rows.map((r) => r.target_type))) {
    if (!targets[type] || disabled.has(targets[type].module)) continue;
    const found = await resolveTargets(
      tx,
      actor,
      type,
      rows.filter((r) => r.target_type === type).map((r) => r.target_id),
    );
    for (const [key, value] of found) resolved.set(type + ':' + key, value);
  }
  return rows.flatMap((r) => {
    const target = resolved.get(r.target_type + ':' + r.target_id);
    return target
      ? [
          {
            id: r.id,
            target_type: r.target_type,
            target_id: r.target_id,
            sort_order: r.sort_order,
            ...target,
          },
        ]
      : [];
  });
}
export async function createFavorite(tx, actor, input) {
  requirePermission(actor, 'write');
  await assertModule(tx, actor.workspace_id, 'views');
  const spec = targets[input.target_type];
  assert(spec, 422, 'INVALID_FAVORITE', 'Unsupported favorite target');
  await assertModule(tx, actor.workspace_id, spec.module);
  const target = (await resolveTargets(tx, actor, input.target_type, [input.target_id])).get(
    input.target_id,
  );
  if (!target) throw missing('Favorite target');
  const old = await tx.one(
    'SELECT id FROM favorites WHERE workspace_id=? AND owner_id=? AND target_type=? AND target_id=?',
    [actor.workspace_id, actor.id, input.target_type, input.target_id],
  );
  const key = old?.id ?? id(),
    time = now();
  if (old)
    await tx.exec(
      'UPDATE favorites SET archived_at=NULL,updated_at=? WHERE workspace_id=? AND id=?',
      [time, actor.workspace_id, key],
    );
  else
    await tx.exec(
      'INSERT INTO favorites(id,workspace_id,owner_id,target_type,target_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      [key, actor.workspace_id, actor.id, input.target_type, input.target_id, time, time],
    );
  return { id: key, target_type: input.target_type, target_id: input.target_id, ...target };
}
export async function deleteFavorite(tx, actor, key) {
  requirePermission(actor, 'write');
  await assertModule(tx, actor.workspace_id, 'views');
  const row = await tx.one(
    'SELECT id FROM favorites WHERE workspace_id=? AND owner_id=? AND id=?',
    [actor.workspace_id, actor.id, key],
  );
  if (!row) throw missing('Favorite');
  await tx.exec('DELETE FROM favorites WHERE workspace_id=? AND owner_id=? AND id=?', [
    actor.workspace_id,
    actor.id,
    key,
  ]);
  return { ok: true };
}
