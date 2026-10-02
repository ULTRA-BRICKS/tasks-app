import type { Catalog } from '@tickets/contracts';
import { PersonChip } from '@/entities/workspace';
import { peopleDirectory, providerLabel } from '@/shared/lib/people';
import { Avatar } from '@/shared/ui';
/** Every canonical person without a Tasks account: Linear or Slack people and automation apps
 * (docs/PEOPLE-IDENTITY.md, UB-95). Read-only: without a membership there is no role to change.
 * Profiles held apart for review are listed under Identity review instead. */
export function PeopleWithoutAccount({ catalog }: { catalog: Catalog | undefined }) {
  const people = peopleDirectory(catalog)
    .filter((person) => !person.providers.includes('tasks') && !person.needs_review)
    .sort((a, b) => Number(a.bot) - Number(b.bot));
  if (!people.length) return null;
  return (
    <section className="settings-section" aria-labelledby="people-without-account-title">
      <h3 id="people-without-account-title">People without a Tasks account</h3>
      <p className="settings-description">
        Authors and assignees from connected tools. They appear in pickers and history, and cannot
        sign in.
      </p>
      <div className="member-list">
        {people.map((person) => (
          <div className="member-row" key={person.id}>
            <Avatar name={person.name} src={person.avatar_url} size="md" />
            <div>
              <strong>
                <PersonChip id={person.id} display="text" />
              </strong>
              <span>
                {person.bot
                  ? 'Bot'
                  : [person.providers.map(providerLabel).join(', '), person.email]
                      .filter(Boolean)
                      .join(' · ')}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
