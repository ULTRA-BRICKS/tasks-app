import { test, expect } from 'bun:test';
import {
  canonicalPeople,
  isBotProfile,
  resolveIdentities,
} from '../../src/shared/lib/canonical-people.mjs';
const member = { id: 'member', name: 'Alex', email: 'ultra@example.test' };
const linear = {
  id: 'source',
  name: 'Ultra',
  email: 'ULTRA@example.test',
  provider: 'linear',
  source_id: 'linear-id',
};
const slack = {
  id: 'slack',
  name: 'Ultra Slack',
  email: 'ultra@example.test',
  provider: 'slack',
  source_id: 'T1:U1',
  avatar_url: 'https://avatars.slack-edge.com/u1.png',
};
const bind = (member_id, source_person_id) => ({
  member_id,
  source_person_id,
  via: 'slack_user_map',
});
const ids = (people) =>
  people
    .map((person) => [...person.aliases].sort((a, b) => a.localeCompare(b)))
    .sort((a, b) => (a.join() < b.join() ? -1 : 1));
test('one unambiguous identity keeps every legacy alias and prefers Slack presentation', () => {
  const records = [{ ...linear }, { ...slack }];
  const before = JSON.stringify(records);
  const result = canonicalPeople([member], records);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    id: 'member',
    name: 'Ultra Slack',
    avatar_url: slack.avatar_url,
    needs_review: false,
    bot: false,
  });
  expect(new Set(result[0].aliases)).toEqual(new Set(['member', 'source', 'slack']));
  expect(JSON.stringify(records)).toBe(before);
});
test('same names do not merge and ambiguous duplicate provider emails stay separate', () => {
  expect(canonicalPeople([member], [{ ...linear, email: 'another@example.test' }])).toHaveLength(2);
  expect(
    canonicalPeople([member], [linear, { ...linear, id: 'conflict', source_id: 'other' }]),
  ).toHaveLength(3);
  expect(
    canonicalPeople(
      [],
      [
        { id: 'a', name: 'Linear' },
        { id: 'b', name: 'Linear' },
      ],
    ),
  ).toHaveLength(2);
});
test('email matching does not strip dots/plus aliases or invent photos', () => {
  expect(
    canonicalPeople([member], [{ ...linear, email: 'ultra+alias@example.test' }]),
  ).toHaveLength(2);
  const [only] = canonicalPeople([member], [linear]);
  expect(only.id).toBe('member');
  expect(only.avatar_url).toBeNull();
  expect(only.names).toEqual(expect.arrayContaining(['Alex', 'Ultra']));
});
test('same names and photos never merge when emails differ or are missing', () => {
  const photo = 'https://avatars.slack-edge.com/same.png';
  const people = canonicalPeople(
    [{ ...member, avatar_url: photo }],
    [
      { ...linear, name: 'Alex', email: 'someone-else@example.test', avatar_url: photo },
      { id: 'no-email', name: 'Alex', email: null, provider: 'slack', avatar_url: photo },
    ],
  );
  expect(ids(people)).toEqual([['member'], ['no-email'], ['source']]);
  expect(people.every((person) => !person.needs_review)).toBe(true);
});
test('explicit Slack binding joins a member and its Slack profile despite different emails', () => {
  const boundSlack = { ...slack, email: 'personal@example.test' };
  const { people, conflicts } = resolveIdentities(
    [member],
    [boundSlack, linear],
    [bind('member', 'slack')],
  );
  expect(conflicts).toEqual([]);
  expect(people).toHaveLength(1);
  expect(people[0]).toMatchObject({ id: 'member', name: 'Ultra Slack', needs_review: false });
  expect(new Set(people[0].aliases)).toEqual(new Set(['member', 'slack', 'source']));
  // Without the binding, differing emails keep the Slack profile separate.
  expect(canonicalPeople([member], [boundSlack, linear])).toHaveLength(2);
});
test('conflicting and unresolved bindings are refused and reported, never guessed', () => {
  const second = { id: 'member-2', name: 'Danny', email: 'danny@example.test' };
  const lone = { ...slack, email: null };
  const { people, conflicts } = resolveIdentities(
    [member, second],
    [lone],
    [bind('member', 'slack'), bind('member-2', 'slack'), bind('missing-member', 'slack')],
  );
  expect(ids(people)).toEqual([['member'], ['member-2'], ['slack']]);
  expect(conflicts.map((conflict) => conflict.kind).sort((a, b) => a.localeCompare(b))).toEqual([
    'conflicting_binding',
    'unresolved_binding',
  ]);
  const conflicting = conflicts.find((conflict) => conflict.kind === 'conflicting_binding');
  expect(
    conflicting?.profiles.map((profile) => profile.id).sort((a, b) => a.localeCompare(b)),
  ).toEqual(['member', 'member-2', 'slack']);
  expect(people.every((person) => person.needs_review)).toBe(true);
});
test('same-provider duplicate emails stay separate and are marked for review', () => {
  const duplicate = { ...linear, id: 'linear-2', source_id: 'linear-other', name: 'Ultra (old)' };
  const bystander = { id: 'other', name: 'Other', email: 'other@example.test' };
  const { people, conflicts } = resolveIdentities([member, bystander], [linear, duplicate]);
  expect(ids(people)).toEqual([['linear-2'], ['member'], ['other'], ['source']]);
  expect(conflicts).toEqual([
    {
      kind: 'same_provider_email',
      email: 'ultra@example.test',
      providers: ['linear'],
      profiles: [
        {
          id: 'member',
          name: 'Alex',
          provider: 'tasks',
          email: 'ultra@example.test',
          avatar_url: null,
        },
        {
          id: 'source',
          name: 'Ultra',
          provider: 'linear',
          email: 'ULTRA@example.test',
          avatar_url: null,
        },
        {
          id: 'linear-2',
          name: 'Ultra (old)',
          provider: 'linear',
          email: 'ULTRA@example.test',
          avatar_url: null,
        },
      ],
    },
  ]);
  const review = Object.fromEntries(people.map((person) => [person.id, person.needs_review]));
  expect(review).toEqual({ member: true, source: true, 'linear-2': true, other: false });
});
test('binding plus email that would add a second profile of one provider is ambiguous', () => {
  const bound = { ...slack, email: 'personal@example.test' };
  const unbound = { ...slack, id: 'slack-2', source_id: 'T1:U2', name: 'Ultra second Slack' };
  const { people, conflicts } = resolveIdentities(
    [member],
    [bound, unbound],
    [bind('member', 'slack')],
  );
  expect(ids(people)).toEqual([['member', 'slack'], ['slack-2']]);
  expect(conflicts).toMatchObject([
    { kind: 'ambiguous_email', email: 'ultra@example.test', providers: ['slack'] },
  ]);
  // Two accounts are never joined through a bound profile's email either.
  const account = { id: 'member-2', name: 'Other account', email: 'personal@example.test' };
  const accounts = resolveIdentities([member, account], [bound], [bind('member', 'slack')]);
  expect(ids(accounts.people)).toEqual([['member', 'slack'], ['member-2']]);
  expect(accounts.conflicts).toMatchObject([{ kind: 'ambiguous_email', providers: ['tasks'] }]);
});
test('projection does not depend on input order', () => {
  // Each email alone is unambiguous, but together they would give one person two Linear profiles.
  const bound = { ...slack, email: 'personal@example.test' };
  const viaMember = { ...linear, id: 'linear-a', source_id: 'a' };
  const viaSlack = { ...linear, id: 'linear-b', source_id: 'b', email: 'personal@example.test' };
  const sources = [bound, viaMember, viaSlack];
  const outcomes = new Set(
    [sources, [...sources].reverse(), [viaSlack, bound, viaMember]].map((order) => {
      const { people, conflicts } = resolveIdentities([member], order, [bind('member', 'slack')]);
      return JSON.stringify({
        people: ids(people),
        conflicts: conflicts.map((c) => c.kind + ' ' + c.email).sort((a, b) => a.localeCompare(b)),
      });
    }),
  );
  expect(outcomes.size).toBe(1);
  const { people, conflicts } = resolveIdentities([member], sources, [bind('member', 'slack')]);
  expect(ids(people)).toEqual([['linear-a'], ['linear-b'], ['member', 'slack']]);
  expect(conflicts.map((c) => c.kind + ' ' + c.email).sort((a, b) => a.localeCompare(b))).toEqual([
    'ambiguous_email personal@example.test',
    'ambiguous_email ultra@example.test',
  ]);
});
test('bots never join a human by email or binding and stay marked as bots', () => {
  const bot = { ...slack, id: 'bot', name: 'Deploy bot', bot: true };
  const { people, conflicts } = resolveIdentities([member], [bot, linear], [bind('member', 'bot')]);
  expect(ids(people)).toEqual([['bot'], ['member', 'source']]);
  expect(people.find((person) => person.id === 'bot')).toMatchObject({ bot: true });
  expect(people.find((person) => person.id === 'member')).toMatchObject({
    bot: false,
    name: 'Alex',
  });
  expect(conflicts).toMatchObject([{ kind: 'bot_binding' }]);
});
test('resolution never mutates members, sources or bindings', () => {
  const members = [{ ...member }];
  const sources = [{ ...linear }, { ...slack, email: 'personal@example.test' }];
  const bindings = [bind('member', 'slack')];
  const before = JSON.stringify({ members, sources, bindings });
  resolveIdentities(members, sources, bindings);
  expect(JSON.stringify({ members, sources, bindings })).toBe(before);
});
test('Linear OAuth-app and system addresses are bots and keep their own entries', () => {
  const app = {
    id: 'codex',
    name: 'Codex',
    email: 'a4bc02c9-0000-4000-8000-000000000000@OAUTHAPP.linear.app',
    provider: 'linear',
  };
  const system = {
    id: 'linear',
    name: 'Linear',
    email: 'linear-x@linear.linear.app',
    provider: 'linear',
  };
  const human = { ...linear, email: 'person@linear.app' };
  const people = canonicalPeople([], [app, system, human]);
  expect(Object.fromEntries(people.map((person) => [person.id, person.bot]))).toEqual({
    codex: true,
    linear: true,
    source: false,
  });
  expect(isBotProfile({ ...app, provider: 'slack' })).toBe(false);
  expect(
    isBotProfile({ id: 'm', name: 'Member', email: app.email, provider: 'tasks', bot: true }),
  ).toBe(false);
});
// UB-95 shapes from the 30 September inventory, with synthetic addresses.
const emailShaped = /[^\s@]+@[^\s@]+/;
test('an email-shaped or empty name falls back to a name derived from the address', () => {
  const niko = {
    id: 'niko',
    name: 'niko@example.test',
    email: 'niko@example.test',
    provider: 'linear',
  };
  const dotted = {
    id: 'irine',
    name: ' ',
    email: 'irine.latsoshvili+work@example.test',
    provider: 'linear',
  };
  const noEmail = { id: 'nameless', name: 'x_y@example.test', email: null, provider: 'linear' };
  const titleCase = {
    id: 'title-case',
    name: 'MIXED.CASE+work@example.test',
    email: null,
    provider: 'linear',
  };
  const bare = { id: 'bare', name: '', email: null, provider: 'linear' };
  const people = canonicalPeople([], [niko, dotted, noEmail, titleCase, bare]);
  expect(Object.fromEntries(people.map((person) => [person.id, person.name]))).toEqual({
    niko: 'Niko',
    irine: 'Irine Latsoshvili',
    nameless: 'X Y',
    'title-case': 'Mixed Case',
    bare: 'Unknown person',
  });
  for (const person of people) {
    expect(person.name).not.toMatch(emailShaped);
    for (const name of person.names) expect(name).not.toMatch(emailShaped);
  }
  // The address stays the email, not the name.
  expect(people.find((person) => person.id === 'niko')?.email).toBe('niko@example.test');
});
test('a real name from any linked profile wins over an address, and photos merge (Danny shape)', () => {
  const danny = { id: 'danny', name: 'Danny', email: 'danny@example.test' };
  const dannyInLinear = {
    id: 'danny-linear',
    name: 'danny@example.test',
    email: 'danny@example.test',
    provider: 'linear',
    avatar_url: 'https://public.linear.app/danny.png',
  };
  // The member name wins; the only photo comes from the Linear alias.
  expect(canonicalPeople([danny], [dannyInLinear])).toMatchObject([
    { id: 'danny', name: 'Danny', avatar_url: dannyInLinear.avatar_url, names: ['Danny'] },
  ]);
  // A member whose account name is an address takes the Linear full name before another
  // provider's, whatever the input order.
  const invited = { id: 'member', name: 'saba@example.test', email: 'saba@example.test' };
  const saba = {
    id: 'saba-linear',
    name: 'Saba Chitaishvili',
    email: 'saba@example.test',
    provider: 'linear',
  };
  const github = { id: 'a-github', name: 'sabac', email: 'saba@example.test', provider: 'github' };
  for (const sources of [
    [saba, github],
    [github, saba],
  ])
    expect(canonicalPeople([invited], sources)[0]).toMatchObject({
      id: 'member',
      name: 'Saba Chitaishvili',
    });
  // An email-shaped Slack name does not override a real account name.
  const slackAddress = {
    id: 'slack-danny',
    name: 'danny@example.test',
    email: 'danny@example.test',
    provider: 'slack',
    source_id: 'T1:U9',
    avatar_url: 'https://avatars.slack-edge.com/danny.png',
  };
  expect(canonicalPeople([danny], [dannyInLinear, slackAddress])[0]).toMatchObject({
    name: 'Danny',
    avatar_url: slackAddress.avatar_url,
  });
});
test('address fallback tries email-shaped names before linked-profile emails', () => {
  const member = { id: 'member', name: '', email: null };
  const slack = {
    id: 'slack',
    name: '',
    email: 'beth@example.test',
    provider: 'slack',
    source_id: 'T1:U1',
  };
  const linear = {
    id: 'linear',
    name: 'anna@example.test',
    email: 'beth@example.test',
    provider: 'linear',
  };
  expect(
    canonicalPeople(
      [member],
      [slack, linear],
      [{ member_id: member.id, source_person_id: slack.id }],
    ),
  ).toMatchObject([{ id: member.id, name: 'Anna' }]);
});
test('profiles held apart for review are named without their addresses', () => {
  const { conflicts } = resolveIdentities(
    [],
    [
      { id: 'a', name: 'tekla@example.test', email: 'tekla@example.test', provider: 'linear' },
      { id: 'b', name: 'Tekla', email: 'tekla@example.test', provider: 'linear' },
    ],
  );
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0].profiles.map((profile) => profile.name).sort()).toEqual(['Tekla', 'Tekla']);
  expect(conflicts[0].profiles.map((profile) => profile.email)).toEqual([
    'tekla@example.test',
    'tekla@example.test',
  ]);
});
