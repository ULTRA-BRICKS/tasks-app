import { test, expect } from 'bun:test';
import {
  mapIssue,
  mapComment,
  ISSUE_MERGE_FIELDS,
} from '../../packages/server/modules/linear-sync/map.mjs';
import { mergeFields } from '../../packages/server/modules/linear-sync/merge.mjs';

function resolver(table) {
  return (collection, sourceId) => table[collection]?.[sourceId] ?? null;
}

test('mapIssue resolves every reference through the injected resolver, never minting new ids', () => {
  const table = {
    teams: { 'team-1': 'target-team-1' },
    workflowStates: { 'state-1': 'target-state-1' },
    users: { 'user-1': 'target-user-1' },
  };
  const record = {
    id: 'issue-1',
    identifier: 'SRC-1',
    number: 1,
    title: 'Title',
    description: 'Body',
    priority: 2,
    sortOrder: 5,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    team: { id: 'team-1' },
    state: { id: 'state-1' },
    assignee: { id: 'user-1' },
    creator: { id: 'user-1' },
    labelIds: [],
  };
  const mapped = mapIssue(record, resolver(table));
  expect(mapped.blocked).toBe(false);
  expect(mapped.fields.team_id).toBe('target-team-1');
  expect(mapped.fields.status_id).toBe('target-state-1');
  expect(mapped.fields.assignee_source_id).toBe('target-user-1');
});
test('mapIssue reports every unresolved reference as blocked instead of a partial write', () => {
  const record = {
    id: 'issue-1',
    identifier: 'SRC-1',
    number: 1,
    title: 'Title',
    priority: 2,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    team: { id: 'team-1' },
    state: { id: 'state-1' },
    project: { id: 'missing-project' },
    labelIds: ['missing-label'],
  };
  const mapped = mapIssue(
    record,
    resolver({ teams: { 'team-1': 't' }, workflowStates: { 'state-1': 's' } }),
  );
  expect(mapped.blocked).toBe(true);
  expect(mapped.malformed).toEqual([]); // every mandatory scalar/ref is present and valid
  expect(mapped.missing).toContain('project_id');
  expect(mapped.missing).toContain('label:missing-label');
});
// A malformed payload short-circuits BEFORE reference resolution even runs (see
// issueMalformedFields in map.mjs) -- a payload that's already malformed shouldn't also
// report unresolved-reference noise mixed in with the malformed-field list. This is the
// intended design, not a bug: assert the early-return shape (malformed populated, missing
// empty), not a hybrid.
test('mapIssue: a malformed payload short-circuits before reference resolution -- malformed only, missing stays empty', () => {
  const record = {
    id: 'issue-1',
    identifier: 'SRC-1',
    number: 1,
    title: 'Title',
    // priority/createdAt/updatedAt intentionally absent: malformed.
    team: { id: 'team-1' },
    state: { id: 'state-1' },
    project: { id: 'missing-project' }, // would ALSO be an unresolved reference...
  };
  const mapped = mapIssue(
    record,
    resolver({ teams: { 'team-1': 't' }, workflowStates: { 'state-1': 's' } }),
  );
  expect(mapped.blocked).toBe(true);
  expect(mapped.malformed).toEqual(expect.arrayContaining(['priority', 'createdAt', 'updatedAt']));
  expect(mapped.missing).toEqual([]); // ...but reference resolution never ran to report it
});
test('mapComment blocks on an unmapped issue reference and reports it by name', () => {
  const mapped = mapComment(
    {
      id: 'c1',
      issueId: 'issue-x',
      body: 'hi',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    },
    resolver({}),
  );
  expect(mapped.blocked).toBe(true);
  expect(mapped.malformed).toEqual([]);
  expect(mapped.missing).toEqual(['issue_id']);
});
test('mapComment resolves an issue and an optional user reference', () => {
  const mapped = mapComment(
    {
      id: 'c1',
      issueId: 'issue-x',
      user: { id: 'user-1' },
      body: 'hi',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    },
    resolver({ issues: { 'issue-x': 'target-issue' }, users: { 'user-1': 'target-user' } }),
  );
  expect(mapped.blocked).toBe(false);
  expect(mapped.fields).toEqual({
    issue_id: 'target-issue',
    author_source_id: 'target-user',
    body: 'hi',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-02T00:00:00.000Z',
  });
});

test('mergeFields: remote-only change applies cleanly with no conflict (local untouched field)', () => {
  const baseline = { title: 'Orig', priority: 0 };
  const local = { title: 'Orig', priority: 0 };
  const remote = { title: 'Orig', priority: 3 };
  const { result, conflicts } = mergeFields(baseline, local, remote, ['title', 'priority']);
  expect(result).toEqual({ title: 'Orig', priority: 3 });
  expect(conflicts).toEqual([]);
});
test('mergeFields: a genuine double-edit records a conflict and keeps the local value', () => {
  // The exact scenario from the spec: import an issue, edit the title locally, then a
  // webhook changes only priority remotely. Title must stay the local edit; priority
  // must become the new remote value; and only the double-edited field is conflicted.
  const baseline = { title: 'Orig', priority: 0 };
  const local = { title: 'Edited locally', priority: 0 };
  const remote = { title: 'Orig', priority: 3 };
  const { result, conflicts } = mergeFields(baseline, local, remote, ['title', 'priority']);
  expect(result.title).toBe('Edited locally');
  expect(result.priority).toBe(3);
  expect(conflicts).toEqual([]);
});
test('mergeFields: both sides changed the SAME field differently -> conflict, local wins', () => {
  const baseline = { title: 'Orig' };
  const local = { title: 'Local edit' };
  const remote = { title: 'Remote edit' };
  const { result, conflicts } = mergeFields(baseline, local, remote, ['title']);
  expect(result.title).toBe('Local edit');
  expect(conflicts).toEqual([
    {
      field: 'title',
      baseline_value: 'Orig',
      local_value: 'Local edit',
      remote_value: 'Remote edit',
    },
  ]);
});
test('mergeFields covers every field the worker tracks for issues without throwing', () => {
  const flat = Object.fromEntries(ISSUE_MERGE_FIELDS.map((f) => [f, null]));
  const { result, conflicts } = mergeFields(flat, flat, flat, ISSUE_MERGE_FIELDS);
  expect(conflicts).toEqual([]);
  expect(Object.keys(result)).toEqual([...ISSUE_MERGE_FIELDS]);
});

// finding 2: label ORDER must never be treated as part of the merged VALUE. An unordered
// `SELECT label_id FROM issue_labels` (no ORDER BY) compared via JSON.stringify equality
// would otherwise manufacture a false conflict whenever SQL happens to return the same
// members in a different order than the (also unordered) baseline/remote, silently
// dropping a real remote add/remove instead of applying it.
test('mapIssue sorts label_ids so member order never becomes part of the mapped value (finding 2)', () => {
  const table = {
    issueLabels: { 'label-z': 'target-z', 'label-a': 'target-a', 'label-m': 'target-m' },
  };
  const record = {
    id: 'issue-1',
    identifier: 'SRC-1',
    number: 1,
    title: 'Title',
    priority: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    team: { id: 'team-1' },
    state: { id: 'state-1' },
    labelIds: ['label-z', 'label-a', 'label-m'],
  };
  const mapped = mapIssue(
    record,
    resolver({ ...table, teams: { 'team-1': 't' }, workflowStates: { 'state-1': 's' } }),
  );
  expect(mapped.blocked).toBe(false);
  expect(mapped.fields.label_ids).toEqual(['target-a', 'target-m', 'target-z']);
});
// The next four tests simulate worker.mjs's contract: every side of the 3-way compare is
// sorted before mergeFields ever sees it (issueRowToMergeFields sorts the SQL result;
// mapIssue sorts baseline/remote, as proven above).
test('mergeFields: label_ids with the SAME members in different order is a no-op, never a conflict', () => {
  const sort = (labels) => [...labels].sort((a, b) => a.localeCompare(b));
  const baseline = { label_ids: sort(['a', 'b', 'c']) };
  const local = { label_ids: sort(['c', 'a', 'b']) }; // same members, different SQL-returned order
  const remote = { label_ids: sort(['b', 'c', 'a']) }; // same members, yet another order
  const { result, conflicts } = mergeFields(baseline, local, remote, ['label_ids']);
  expect(result.label_ids).toEqual(['a', 'b', 'c']);
  expect(conflicts).toEqual([]);
});
test('mergeFields: a genuine remote label ADD applies cleanly even with permuted local order', () => {
  const sort = (labels) => [...labels].sort((a, b) => a.localeCompare(b));
  const baseline = { label_ids: sort(['a', 'b']) };
  const local = { label_ids: sort(['b', 'a']) }; // unchanged, just unsorted
  const remote = { label_ids: sort(['a', 'b', 'c']) }; // genuine add of 'c'
  const { result, conflicts } = mergeFields(baseline, local, remote, ['label_ids']);
  expect(result.label_ids).toEqual(['a', 'b', 'c']);
  expect(conflicts).toEqual([]);
});
test('mergeFields: a genuine remote label REMOVE applies cleanly even with permuted local order', () => {
  const sort = (labels) => [...labels].sort((a, b) => a.localeCompare(b));
  const baseline = { label_ids: sort(['a', 'b', 'c']) };
  const local = { label_ids: sort(['c', 'b', 'a']) }; // unchanged, just unsorted
  const remote = { label_ids: sort(['a', 'c']) }; // genuine remove of 'b'
  const { result, conflicts } = mergeFields(baseline, local, remote, ['label_ids']);
  expect(result.label_ids).toEqual(['a', 'c']);
  expect(conflicts).toEqual([]);
});
test('mergeFields: simultaneous local-add and remote-add of DIFFERENT labels is still a real conflict', () => {
  const sort = (labels) => [...labels].sort((a, b) => a.localeCompare(b));
  const baseline = { label_ids: sort(['a']) };
  const local = { label_ids: sort(['a', 'x']) }; // local added x
  const remote = { label_ids: sort(['a', 'y']) }; // remote added y
  const { result, conflicts } = mergeFields(baseline, local, remote, ['label_ids']);
  expect(result.label_ids).toEqual(['a', 'x']); // local wins, conflict recorded
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0].field).toBe('label_ids');
});
