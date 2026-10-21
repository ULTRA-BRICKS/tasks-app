import { assert } from '../../core/errors.mjs';
import { sameField } from './merge-fields.mjs';
const PERSON_FIELDS = new Set(['assignee_id', 'lead_id', 'owner_id']);

// Read-only identity equivalence: preserve attribution and require exactly one member
// and one mapped source person in this workspace and Linear organization.
export async function sourcePersonAliases(tx, config, requestedMembers, requestedPeople) {
  const members = [...new Set(requestedMembers)],
    people = [...new Set(requestedPeople)];
  assert(
    members.length + people.length <= 1000,
    422,
    'SYNC_REFERENCE_BUDGET',
    'Too many person references',
  );
  if (!members.length && !people.length) return [];
  const clauses = [],
    args = [config.workspaceId, config.workspaceId, config.organizationId];
  if (members.length) {
    clauses.push('u.member_id IN (' + members.map(() => '?').join(',') + ')');
    args.push(...members);
  }
  if (people.length) {
    clauses.push('p.person_id IN (' + people.map(() => '?').join(',') + ')');
    args.push(...people);
  }
  // Compute uniqueness before filtering to requested IDs. Each scoped set is read once;
  // a duplicate not named in the request must still make the alias ambiguous.
  return tx.all(
    `WITH member_emails AS (
      SELECT u.id AS member_id, LOWER(TRIM(u.email)) AS email,
        COUNT(*) OVER (PARTITION BY LOWER(TRIM(u.email))) AS matches
      FROM memberships membership JOIN users u ON u.id=membership.user_id
      WHERE membership.workspace_id=? AND NULLIF(TRIM(u.email),'') IS NOT NULL
    ), source_emails AS (
      SELECT p.id AS person_id, m.source_id, LOWER(TRIM(p.email)) AS email,
        COUNT(*) OVER (PARTITION BY LOWER(TRIM(p.email))) AS matches
      FROM source_people p JOIN linear_source_map m ON m.workspace_id=p.workspace_id
        AND m.collection='users' AND m.target_id=p.id AND m.source_id=p.source_id
      WHERE p.workspace_id=? AND m.source_workspace_id=? AND p.provider='linear'
        AND NULLIF(TRIM(p.email),'') IS NOT NULL
    )
    SELECT u.member_id,p.person_id,p.source_id
    FROM member_emails u JOIN source_emails p ON p.email=u.email
    WHERE u.matches=1 AND p.matches=1 AND (${clauses.join(' OR ')})`,
    args,
  );
}
export function personFieldComparator(aliases) {
  const canonical = new Map(
    aliases.flatMap((a) => [
      [a.member_id, a.person_id],
      [a.person_id, a.person_id],
    ]),
  );
  return (field, a, b) =>
    sameField(field, a, b) ||
    (PERSON_FIELDS.has(field) &&
      a != null &&
      b != null &&
      canonical.has(a) &&
      canonical.get(a) === canonical.get(b));
}
