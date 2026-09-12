import { assert, requirePermission } from './errors.mjs';
import { assertModule } from './modules.mjs';
import { sha256, now } from './crypto.mjs';
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export async function createIdempotently(tx, actor, { key, operation, module, input }, create) {
  requirePermission(actor, 'write');
  await assertModule(tx, actor.workspace_id, module);
  if (!key) return create();
  assert(/^[\w.:/-]{1,160}$/.test(key), 422, 'INVALID_IDEMPOTENCY_KEY', 'Invalid idempotency key');
  const legacyHash = sha256(JSON.stringify({ operation, input }));
  const hash = sha256(JSON.stringify(canonical({ operation, input })));
  const previous = await tx.one(
    'SELECT request_hash,response FROM idempotency_keys WHERE workspace_id=? AND user_id=? AND key=?',
    [actor.workspace_id, actor.id, key],
  );
  if (previous) {
    assert(
      previous.request_hash === hash || previous.request_hash === legacyHash,
      409,
      'IDEMPOTENCY_CONFLICT',
      'Idempotency key was used with a different request',
    );
    return JSON.parse(previous.response);
  }
  const result = await create();
  await tx.exec(
    'INSERT INTO idempotency_keys(workspace_id,user_id,key,request_hash,response,created_at) VALUES(?,?,?,?,?,?)',
    [actor.workspace_id, actor.id, key, hash, JSON.stringify(result), now()],
  );
  return result;
}
