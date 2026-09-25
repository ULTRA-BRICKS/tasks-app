import { test, expect } from 'bun:test';
import { canonicalPeople } from '../../src/shared/lib/canonical-people.mjs';
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
test('one unambiguous identity keeps every legacy alias and prefers Slack presentation', () => {
  const records = [{ ...linear }, { ...slack }];
  const before = JSON.stringify(records);
  const result = canonicalPeople([member], records);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    id: 'member',
    name: 'Ultra Slack',
    avatar_url: slack.avatar_url,
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
