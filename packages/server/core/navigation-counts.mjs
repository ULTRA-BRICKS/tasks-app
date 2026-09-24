import { requirePermission } from './errors.mjs';
/** Workspace-scoped totals; independent of issue-list pagination and active filters. */
export async function navigationCounts(tx, actor) {
  requirePermission(actor, 'read');
  const workspace = actor.workspace_id;
  const row = await tx.one(
    `SELECT
    (SELECT COUNT(*) FROM issues WHERE workspace_id=? AND deleted_at IS NULL AND archived_at IS NULL) AS issues,
    (SELECT COUNT(*) FROM issues WHERE workspace_id=? AND kind='epic' AND deleted_at IS NULL AND archived_at IS NULL) AS epics,
    (SELECT COUNT(*) FROM issues WHERE workspace_id=? AND assignee_id=? AND deleted_at IS NULL AND archived_at IS NULL) AS mine,
    (SELECT COUNT(*) FROM projects WHERE workspace_id=? AND archived_at IS NULL) AS projects,
    (SELECT COUNT(*) FROM cycles WHERE workspace_id=?) AS cycles,
    (SELECT COUNT(*) FROM documents WHERE workspace_id=? AND archived_at IS NULL) AS documents,
    (SELECT COUNT(*) FROM initiatives WHERE workspace_id=? AND archived_at IS NULL) AS initiatives,
    (SELECT COUNT(*) FROM issues WHERE workspace_id=? AND deleted_at IS NULL AND archived_at IS NOT NULL) AS archive`,
    [
      workspace,
      workspace,
      workspace,
      actor.id,
      workspace,
      workspace,
      workspace,
      workspace,
      workspace,
    ],
  );
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}
