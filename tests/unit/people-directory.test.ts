import { test, expect } from 'bun:test';
import type { Catalog } from '@tickets/contracts';
import {
  canonicalPersonValue,
  identityConflicts,
  peopleDirectory,
  personOptions,
  selectedPerson,
} from '../../src/shared/lib/people';
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
test('every legacy ID resolves to one picker entry while review conflicts and bots stay labeled', () => {
  const profile = (id: string, name: string, email: string, provider: string, extra = {}) => ({
    id,
    name,
    email,
    provider,
    source_id: id,
    avatar_url: null,
    ...extra,
  });
  const c = {
    people: [
      { id: 'ultra', name: 'Ultra', email: 'ultra@example.test', role: 'owner' },
      { id: 'danny', name: 'Danny', email: 'danny@example.test', role: 'member' },
    ],
    source_people: [
      profile('ultra-linear', 'Ultra L', 'ULTRA@example.test', 'linear'),
      profile('ultra-slack', 'Ultra S', 'private@example.test', 'slack'),
      profile('ci-bot', 'CI', 'ultra@example.test', 'slack', { bot: true }),
      profile('danny-linear-1', 'Danny', 'danny@example.test', 'linear'),
      profile('danny-linear-2', 'Danny', 'danny@example.test', 'linear'),
    ],
    identity_bindings: [
      { member_id: 'ultra', source_person_id: 'ultra-slack', via: 'slack_user_map' },
    ],
  } as Catalog;
  const options = personOptions(c);
  expect(options.map((option) => [option.value, option.label, option.description])).toEqual([
    ['ci-bot', 'CI', 'Bot'],
    ['danny', 'Danny', 'Member · Needs review'],
    ['danny-linear-1', 'Danny', 'Linear · Needs review'],
    ['danny-linear-2', 'Danny', 'Linear · Needs review'],
    ['ultra', 'Ultra S', undefined],
  ]);
  for (const id of ['ultra', 'ultra-linear', 'ultra-slack'])
    expect(canonicalPersonValue(c, id)).toBe('ultra');
  for (const id of ['danny', 'danny-linear-1', 'danny-linear-2'])
    expect(canonicalPersonValue(c, id)).toBe(id);
  expect(identityConflicts(c)).toMatchObject([
    { kind: 'same_provider_email', email: 'danny@example.test', providers: ['linear'] },
  ]);
  expect(identityConflicts(c)).toBe(identityConflicts(c));
});
