import type { Catalog } from '@tickets/contracts';
import { PersonChip } from '@/entities/workspace';
import { identityConflicts, providerLabel } from '@/shared/lib/people';
import type { IdentityConflict } from '@/shared/lib/canonical-people.mjs';
function reason(conflict: IdentityConflict) {
  const providers = conflict.providers.map(providerLabel).join(', ');
  switch (conflict.kind) {
    case 'same_provider_email':
      return `More than one ${providers} profile uses ${conflict.email}`;
    case 'ambiguous_email':
      return `${conflict.email} matches more than one linked identity`;
    case 'conflicting_binding':
      return `One ${providers} profile is mapped to more than one member`;
    case 'bot_binding':
      return `A ${providers} mapping points to a bot`;
    case 'unresolved_binding':
      return 'A mapping points to a missing profile';
  }
}
/** Read-only: conflicts are shown for a later verified alias decision, never resolved here. */
export function IdentityReview({ catalog }: { catalog: Catalog | undefined }) {
  const conflicts = identityConflicts(catalog);
  if (!conflicts.length) return null;
  return (
    <section className="settings-section identity-review" aria-labelledby="identity-review-title">
      <h3 id="identity-review-title">Identity review</h3>
      <p className="settings-description">
        These profiles were not merged automatically. Assignments and history keep their original
        people until a verified alias decision.
      </p>
      <ul className="identity-conflicts">
        {conflicts.map((conflict) => (
          <li
            className="identity-conflict"
            key={conflict.kind + ':' + conflict.profiles.map((p) => p.id).join(',')}
          >
            <p className="identity-conflict-reason">
              <span className="review-badge">Needs review</span>
              {reason(conflict)}
            </p>
            <ul className="identity-profiles">
              {conflict.profiles.map((profile) => (
                <li key={profile.id}>
                  <PersonChip id={profile.id} display="name" label={profile.name} />
                  <span className="identity-provider">{providerLabel(profile.provider)}</span>
                  {profile.email && <span className="identity-email">{profile.email}</span>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
