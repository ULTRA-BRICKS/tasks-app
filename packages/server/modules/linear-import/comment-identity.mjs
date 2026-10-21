/** Import/append planning and apply share this check for previously unmapped comments.
 * Callers exclude canonical source bindings; raw UUID rows cannot be adopted implicitly.
 * HYP-1711: derived import IDs otherwise allow a second comment beside a raw source UUID.
 */
import { assert } from '../../core/errors.mjs';

export async function assertUnboundCommentIdsAvailable(tx, workspace, sourceIds) {
  if (!sourceIds.length) return;
  // Source UUID validation permits mixed casing. Compare both stored and supplied
  // forms canonically without rewriting either identity or its provenance hash.
  // A JSON set keeps bulk snapshots to one bounded request instead of hundreds
  // of sequential round trips, and avoids dialect parameter-count ceilings.
  const incoming =
    tx.dialect === 'postgres'
      ? 'jsonb_array_elements_text(CAST(? AS JSONB)) AS incoming(value)'
      : 'json_each(?) AS incoming';
  const collisions = await tx.all(
    `SELECT c.id FROM comments c WHERE c.workspace_id=? AND lower(c.id) IN (SELECT value FROM ${incoming}) LIMIT 1`,
    [workspace, JSON.stringify(sourceIds.map((id) => id.toLowerCase()))],
  );
  assert(
    !collisions.length,
    409,
    'COMMENT_SOURCE_BINDING_REQUIRED',
    'Explicit source binding/reconciliation required; no changes. A comment already uses an unmapped source UUID in this workspace. Review an explicit target with /api/v1/imports/linear/bind before append; reconcile existing duplicates separately.',
  );
}
