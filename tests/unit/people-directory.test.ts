import { test, expect } from 'bun:test';
import type { Catalog } from '@tickets/contracts';
import { peopleDirectory, personOptions, selectedPerson } from '../../src/shared/lib/people';
const catalog = () =>
  ({
    people: [{ id: 'member', name: 'Person', email: 'person@example.test' }],
    source_people: [
      {
        id: 'source',
        name: 'Alias',
        email: 'person@example.test',
        provider: 'linear',
        source_id: 'one',
      },
    ],
  }) as Catalog;
test('one catalog creates a shared directory, aliases and option references rather than rebuilding per row', () => {
  const c = catalog(),
    directory = peopleDirectory(c),
    options = personOptions(c);
  for (let i = 0; i < 100; i++) {
    expect(peopleDirectory(c)).toBe(directory);
    expect(personOptions(c)).toBe(options);
    expect(selectedPerson(c, 'source')).toBe(directory[0]);
    expect(selectedPerson(c, 'member')).toBe(directory[0]);
  }
});
test('new catalog identity refreshes names without leaking another workspace projection', () => {
  const first = catalog(),
    second = catalog();
  second.people[0].name = 'Updated';
  expect(peopleDirectory(first)).not.toBe(peopleDirectory(second));
  expect(selectedPerson(second, 'member')?.name).toBe('Updated');
  expect(selectedPerson(first, 'member')?.name).toBe('Person');
});
