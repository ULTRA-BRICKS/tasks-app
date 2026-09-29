import { AppError, assert, requirePermission } from '../../core/errors.mjs';
/** Same shape as a canonical source code; percent-encoded or lowercase input never matches. */
export const TASK_CODE_PATTERN = '^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,14}$';
const CODE = new RegExp(TASK_CODE_PATTERN);
const notFound = () =>
  new AppError(404, 'NOT_FOUND', 'No task had this code before canonical renumbering');
/** Fail closed: skipping an unreadable receipt could silently hide one of the tasks. */
function parseReceipt({ id, payload, created_at }) {
  let pairs;
  try {
    ({ pairs } = JSON.parse(payload));
  } catch {
    pairs = null;
  }
  assert(
    Array.isArray(pairs) &&
      pairs.every((p) => [p?.id, p?.oldCode, p?.newCode].every((v) => typeof v === 'string')),
    500,
    'INVALID_NUMBERING_RECEIPT',
    'A canonical renumbering receipt is unreadable',
  );
  return { id, at: created_at, pairs };
}
/**
 * Origin-qualified lookup required by LINEAR-CANONICAL-PLAN.md L16: which tasks held `code` before a
 * canonical renumbering. Reads only this workspace's migration receipts, which are written in the same
 * transaction as the code changes. When several tasks held the code, returns all of them; never picks one.
 */
export async function resolvePreCanonicalCode(tx, actor, code) {
  requirePermission(actor, 'read');
  if (!CODE.test(code)) throw notFound();
  const rows = await tx.all(
    "SELECT id,payload,created_at FROM outbox WHERE workspace_id=? AND provider='linear-numbering' AND event='canonical-migration' AND status='state' ORDER BY created_at,id",
    [actor.workspace_id],
  );
  const receipts = rows.map(parseReceipt);
  // Receipt positions (chronological) per task that held `code`: its chain starts at `earliest`;
  // `latest` orders ambiguous matches newest first.
  const held = new Map();
  receipts.forEach(({ pairs }, position) => {
    for (const pair of pairs)
      if (pair.oldCode === code)
        held.set(pair.id, { earliest: held.get(pair.id)?.earliest ?? position, latest: position });
  });
  if (!held.size) throw notFound();
  // One pass: each held task's code in every receipt from `earliest` on, i.e. its chain to today.
  const steps = new Map([...held.keys()].map((id) => [id, []]));
  receipts.forEach((receipt, position) => {
    for (const pair of receipt.pairs)
      if (position >= (held.get(pair.id)?.earliest ?? Infinity))
        steps.get(pair.id).push({
          migration_id: receipt.id,
          at: receipt.at,
          from: pair.oldCode,
          to: pair.newCode,
        });
  });
  const ids = [...held.keys()];
  const tasks = await tx.all(
    `SELECT i.id,i.key,i.title,s.name AS status_name,s.category AS status_category,s.color AS status_color FROM issues i JOIN statuses s ON s.id=i.status_id AND s.workspace_id=i.workspace_id WHERE i.workspace_id=? AND i.deleted_at IS NULL AND i.id IN (${ids.map(() => '?').join(',')})`,
    [actor.workspace_id, ...ids],
  );
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const current = await tx.one(
    'SELECT id,key,title FROM issues WHERE workspace_id=? AND key=? AND deleted_at IS NULL',
    [actor.workspace_id, code],
  );
  return {
    code,
    origin: 'pre-canonical',
    ambiguous: held.size > 1,
    current: current ?? null,
    matches: [...held]
      .sort(([, a], [, b]) => b.latest - a.latest)
      .map(([id]) => ({ task: taskById.get(id) ?? null, steps: steps.get(id) })),
  };
}
