import {
  resolveIdentities,
  type CanonicalPerson,
  type IdentityConflict,
  type IdentityResolution,
} from './canonical-people.mjs';
import type { Actor, Catalog } from '@tickets/contracts';
export type PersonDirectory = CanonicalPerson[];
type PersonOption = {
  value: string;
  label: string;
  avatar_url?: string | null;
  description?: string;
  disabled?: boolean;
};
type DirectoryIndex = {
  aliases: Map<string, CanonicalPerson>;
  options: PersonOption[];
  editable: PersonOption[];
  readonly: PersonOption[];
};
const catalogResolutions = new WeakMap<Catalog, IdentityResolution>();
const catalogRoles = new WeakMap<Catalog, Map<string, Actor['role']>>();
const directoryIndexes = new WeakMap<PersonDirectory, DirectoryIndex>();
const emptyResolution: IdentityResolution = { people: [], conflicts: [] };
const providerLabels: Record<string, string> = {
  tasks: 'Member',
  linear: 'Linear',
  slack: 'Slack',
};
export const providerLabel = (provider: string) =>
  providerLabels[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
/** Records held apart by a conflict must stay distinguishable in a picker. */
function optionDescription(person: CanonicalPerson) {
  if (person.bot) return 'Bot';
  if (person.needs_review)
    return [...person.providers.map(providerLabel), 'Needs review'].join(' · ');
}
function index(directory: PersonDirectory): DirectoryIndex {
  const saved = directoryIndexes.get(directory);
  if (saved) return saved;
  const aliases = new Map<string, CanonicalPerson>();
  for (const person of directory) for (const alias of person.aliases) aliases.set(alias, person);
  const options = directory.map((person): PersonOption => {
    const description = optionDescription(person);
    return {
      value: person.id,
      label: person.name,
      avatar_url: person.avatar_url,
      ...(description ? { description } : {}),
    };
  });
  const editable = [{ value: 'none', label: 'Unassigned' }, ...options];
  const result = {
    aliases,
    options,
    editable,
    readonly: editable.map((option) => ({ ...option, disabled: true })),
  };
  directoryIndexes.set(directory, result);
  return result;
}
function resolution(catalog: Catalog | undefined): IdentityResolution {
  if (!catalog) return emptyResolution;
  const saved = catalogResolutions.get(catalog);
  if (saved) return saved;
  const resolved = resolveIdentities(
    catalog.people,
    catalog.source_people ?? [],
    catalog.identity_bindings ?? [],
  );
  catalogResolutions.set(catalog, resolved);
  return resolved;
}
export const peopleDirectory = (catalog: Catalog | undefined): PersonDirectory =>
  resolution(catalog).people;
export const identityConflicts = (catalog: Catalog | undefined): IdentityConflict[] =>
  resolution(catalog).conflicts;
export const personInDirectory = (directory: PersonDirectory, id: string | null | undefined) =>
  index(directory).aliases.get(id ?? '');
export const assigneeOptions = (directory: PersonDirectory, readonly: boolean) =>
  readonly ? index(directory).readonly : index(directory).editable;
export const selectedPerson = (catalog: Catalog | undefined, id: string | null | undefined) =>
  personInDirectory(peopleDirectory(catalog), id);
export const personOptions = (catalog: Catalog | undefined) =>
  index(peopleDirectory(catalog)).options;
export const canonicalPersonValue = (catalog: Catalog | undefined, id: string | null | undefined) =>
  selectedPerson(catalog, id)?.id ?? id ?? 'none';
/** Everything a person card shows, selected from the UB-29 projection (docs/PERSON-POPOVER.md). */
export interface PersonProfile {
  /** Canonical ID: the Tasks member when the person has an account. */
  id: string;
  name: string;
  avatar_url: string | null;
  /** Withheld (null) until the signed-in actor is known; the catalog is the permission authority. */
  email: string | null;
  membership: string;
  accounts: string[];
  bot: boolean;
  needs_review: boolean;
  is_viewer: boolean;
  tasks_href: string;
}
const roleLabels: Record<Actor['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};
export function personProfile(
  catalog: Catalog | undefined,
  id: string | null | undefined,
  viewer: Pick<Actor, 'id' | 'role'> | null | undefined,
): PersonProfile | null {
  const directory = peopleDirectory(catalog),
    person = personInDirectory(directory, id);
  if (!person || !catalog) return null;
  let roles = catalogRoles.get(catalog);
  if (!roles) {
    roles = new Map(catalog.people.map((member) => [member.id, member.role]));
    catalogRoles.set(catalog, roles);
  }
  const role = roles.get(person.id);
  return {
    id: person.id,
    name: person.name,
    avatar_url: person.avatar_url,
    email: viewer ? person.email : null,
    membership: person.bot ? 'Bot' : role ? roleLabels[role] : 'No Tasks account',
    // providerLabel('tasks') is 'Member' (the picker wording); the card lists products.
    accounts: person.providers.map((provider) =>
      provider === 'tasks' ? 'Tasks' : providerLabel(provider),
    ),
    bot: Boolean(person.bot),
    needs_review: person.needs_review,
    is_viewer: viewer ? personInDirectory(directory, viewer.id)?.id === person.id : false,
    tasks_href: '/tasks?' + new URLSearchParams({ assignee_id: person.id }).toString(),
  };
}
