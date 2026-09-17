import { assert } from './errors.mjs';
/** Imported people are attribution rows. This function never inserts accounts/memberships. */
export async function resolvePerson(tx, actor, value) {
  if (value == null) return { member: null, source: null };
  if (
    await tx.one('SELECT user_id FROM memberships WHERE workspace_id=? AND user_id=?', [
      actor.workspace_id,
      value,
    ])
  )
    return { member: value, source: null };
  const found = await tx.one('SELECT id FROM source_people WHERE workspace_id=? AND id=?', [
    actor.workspace_id,
    value,
  ]);
  assert(found, 422, 'INVALID_PERSON', 'Person is not part of this workspace');
  return { member: null, source: value };
}
export async function listSourcePeople(tx, workspace) {
  return tx.all(
    'SELECT id,name,email,avatar_url,provider,source_id FROM source_people WHERE workspace_id=? ORDER BY name,id',
    [workspace],
  );
}
