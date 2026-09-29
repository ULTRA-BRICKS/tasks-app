import {
  resolveIdentities,
  type CanonicalPerson,
  type IdentityConflict,
  type IdentityResolution,
} from './canonical-people.mjs';
import type { Catalog } from '@tickets/contracts';
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
