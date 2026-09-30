import { test, expect } from 'bun:test';
import type { Catalog } from '@tickets/contracts';
import { personProfile } from '../../src/shared/lib/people';
const member = { id: 'viewer', role: 'viewer' as const };
const catalog = () =>
  ({
    people: [
      { id: 'jamie', name: 'Jamie Chen', email: 'jamie@example.test', role: 'admin' },
      { id: 'sam', name: 'Sam Rivera', email: 'sam@example.test', role: 'member' },
    ],
    source_people: [
      {
        id: 'linear-jamie',
        name: 'Jamie C.',
        email: 'jamie@example.test',
        provider: 'linear',
        source_id: 'l1',
        avatar_url: null,
      },
      {
        id: 'slack-jamie',
        name: 'Jamie Chen (Slack)',
        email: 'jamie@example.test',
        provider: 'slack',
        source_id: 's1',
        avatar_url: 'https://avatars.example.test/jamie.png',
      },
      {
        id: 'linear-riley',
        name: 'Riley Imported',
        email: null,
        provider: 'linear',
        source_id: 'l2',
        avatar_url: null,
      },
      {
        id: 'codex',
        name: 'Codex',
        email: 'codex@oauthapp.linear.app',
        provider: 'linear',
        source_id: 'l3',
        avatar_url: null,
        bot: true,
      },
      // Two Linear users sharing Sam's address: kept apart and marked for review (UB-29).
      {
        id: 'linear-sam-a',
        name: 'Sam A',
        email: 'sam@example.test',
        provider: 'linear',
        source_id: 'l4',
        avatar_url: null,
      },
      {
        id: 'linear-sam-b',
        name: 'Sam B',
        email: 'sam@example.test',
        provider: 'linear',
        source_id: 'l5',
        avatar_url: null,
      },
    ],
  }) as Catalog;

test('every alias of a person opens the same canonical profile with linked accounts and role', () => {
  const c = catalog();
  const expected = {
    id: 'jamie',
    name: 'Jamie Chen (Slack)',
    avatar_url: 'https://avatars.example.test/jamie.png',
    email: 'jamie@example.test',
    membership: 'Admin',
    accounts: ['Tasks', 'Linear', 'Slack'],
    bot: false,
    needs_review: false,
    is_viewer: false,
    tasks_href: '/tasks?assignee_id=jamie',
  };
  for (const id of ['jamie', 'linear-jamie', 'slack-jamie'])
    expect(personProfile(c, id, member)).toEqual(expected);
});

test('imported people without an account and bots say so instead of claiming a workspace role', () => {
  const c = catalog();
  expect(personProfile(c, 'linear-riley', member)).toMatchObject({
    id: 'linear-riley',
    membership: 'No Tasks account',
    accounts: ['Linear'],
    email: null,
    bot: false,
    tasks_href: '/tasks?assignee_id=linear-riley',
  });
  expect(personProfile(c, 'codex', member)).toMatchObject({
    id: 'codex',
    membership: 'Bot',
    accounts: ['Linear'],
    bot: true,
  });
});

test('conflict-separated profiles carry the needs-review marker and stay distinct', () => {
  const c = catalog();
  const a = personProfile(c, 'linear-sam-a', member),
    b = personProfile(c, 'linear-sam-b', member);
  expect(a?.needs_review).toBe(true);
  expect(b?.needs_review).toBe(true);
  expect(a?.id).not.toBe(b?.id);
  expect(a?.tasks_href).toBe('/tasks?assignee_id=linear-sam-a');
});

test('email is withheld until the signed-in actor is known, and shown to every role the catalog serves', () => {
  const c = catalog();
  expect(personProfile(c, 'sam', null)?.email).toBeNull();
  expect(personProfile(c, 'sam', undefined)?.email).toBeNull();
  for (const role of ['owner', 'admin', 'member', 'viewer'] as const)
    expect(personProfile(c, 'sam', { id: 'someone', role })?.email).toBe('sam@example.test');
});

test('the signed-in person is marked as the viewer across aliases', () => {
  const c = catalog();
  const me = { id: 'jamie', role: 'admin' as const };
  expect(personProfile(c, 'slack-jamie', me)?.is_viewer).toBe(true);
  expect(personProfile(c, 'sam', me)?.is_viewer).toBe(false);
});

test('unknown, empty and missing-catalog references have no profile', () => {
  const c = catalog();
  expect(personProfile(c, 'removed-account', member)).toBeNull();
  expect(personProfile(c, null, member)).toBeNull();
  expect(personProfile(c, '', member)).toBeNull();
  expect(personProfile(undefined, 'jamie', member)).toBeNull();
});

test('the filter link encodes identifiers', () => {
  const c = catalog();
  c.people.push({ id: 'a&b=c', name: 'Odd Id', email: 'odd@example.test', role: 'member' });
  expect(personProfile(c, 'a&b=c', member)?.tasks_href).toBe('/tasks?assignee_id=a%26b%3Dc');
});
