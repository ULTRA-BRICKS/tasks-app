import { requirePermission } from '../../core/errors.mjs';
import { now } from '../../core/crypto.mjs';
/** Administrative listing excludes the invitation hash and all one-time links. */
export async function listInvitations(tx, actor) {
  requirePermission(actor, 'admin');
  const rows = await tx.all(
    'SELECT id,email,role,created_at,expires_at,used_at FROM invitations WHERE workspace_id=? ORDER BY created_at DESC,id DESC LIMIT 500',
    [actor.workspace_id],
  );
  const time = now();
  return rows.map(({ used_at, ...row }) => ({
    ...row,
    status: used_at ? 'accepted' : row.expires_at <= time ? 'expired' : 'pending',
  }));
}
