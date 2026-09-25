import { canonicalPeople } from './canonical-people.mjs';
import type { Catalog } from '@tickets/contracts';
export type CanonicalPerson = ReturnType<typeof canonicalPeople>[number];
export type PersonDirectory = CanonicalPerson[];
type PersonOption = {
  value: string;
  label: string;
  avatar_url?: string | null;
  disabled?: boolean;
};
type DirectoryIndex = {
  aliases: Map<string, CanonicalPerson>;
  options: PersonOption[];
  editable: PersonOption[];
  readonly: PersonOption[];
};
const catalogDirectories = new WeakMap<Catalog, PersonDirectory>();
const directoryIndexes = new WeakMap<PersonDirectory, DirectoryIndex>();
const emptyDirectory: PersonDirectory = [];
function index(directory: PersonDirectory): DirectoryIndex {
  const saved = directoryIndexes.get(directory);
  if (saved) return saved;
  const aliases = new Map<string, CanonicalPerson>();
  for (const person of directory) for (const alias of person.aliases) aliases.set(alias, person);
  const options = directory.map((person) => ({
    value: person.id,
    label: person.name,
    avatar_url: person.avatar_url,
  }));
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
export function peopleDirectory(catalog: Catalog | undefined): PersonDirectory {
  if (!catalog) return emptyDirectory;
  const saved = catalogDirectories.get(catalog);
  if (saved) return saved;
  const directory = canonicalPeople(catalog.people, catalog.source_people ?? []);
  catalogDirectories.set(catalog, directory);
  return directory;
}
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
