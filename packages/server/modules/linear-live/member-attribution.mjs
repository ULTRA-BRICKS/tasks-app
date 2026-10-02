import { assert } from '../../core/errors.mjs';
// Attribution only: no account merge, invitation, membership or credential writes.
// Probe at most two candidates: multiple matches on either side remain unresolved.
export async function addMemberAttributionAliases(tx, config, memberIds, bySource, byTarget) {
  if (!memberIds.length) return;
  assert(
    memberIds.length <= 16,
    422,
    'SYNC_MEMBER_REFERENCE_BUDGET',
    'Too many member attribution fields',
  );
  const members = await tx.all(
    `SELECT m.user_id,u.email FROM memberships m JOIN users u ON u.id=m.user_id
   WHERE m.workspace_id=? AND m.user_id IN (${memberIds.map(() => '?').join(',')})
   AND length(trim(u.email))>0`,
    [config.workspaceId, ...memberIds],
  );
  for (const member of members) {
    const email = member.email.trim().toLowerCase();
    const peers = await tx.all(
      'SELECT m.user_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND lower(trim(u.email))=? LIMIT 2',
      [config.workspaceId, email],
    );
    if (peers.length !== 1) continue;
    const candidates = await tx.all(
      `SELECT p.id AS person_id,l.source_id FROM source_people p
    JOIN linear_source_map l ON l.workspace_id=p.workspace_id AND l.source_workspace_id=?
      AND l.collection='users' AND l.target_id=p.id AND l.source_id=p.source_id
    WHERE p.workspace_id=? AND p.provider='linear' AND lower(trim(p.email))=? LIMIT 2`,
      [config.organizationId, config.workspaceId, email],
    );
    if (candidates.length !== 1) continue;
    const candidate = candidates[0];
    byTarget.set('users:' + member.user_id, candidate.source_id);
    byTarget.set('users:' + candidate.person_id, candidate.source_id);
    bySource.set('users:' + candidate.source_id, candidate.person_id);
  }
}
