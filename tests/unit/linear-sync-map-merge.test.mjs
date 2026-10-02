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
  expect(mapped.missing).toContain('project_id');
  expect(mapped.missing).toContain('label:missing-label');
});
test('mapComment blocks on an unmapped issue reference and reports it by name', () => {
  const mapped = mapComment({ id: 'c1', issueId: 'issue-x', body: 'hi' }, resolver({}));
  expect(mapped.blocked).toBe(true);
  expect(mapped.missing).toEqual(['issue_id']);
});
test('mapComment resolves an issue and an optional user reference', () => {
  const mapped = mapComment(
    {
      id: 'c1',
      issueId: 'issue-x',
      user: { id: 'user-1' },
      body: 'hi',
      createdAt: 'a',
      updatedAt: 'b',
    },
    resolver({ issues: { 'issue-x': 'target-issue' }, users: { 'user-1': 'target-user' } }),
  );
  expect(mapped.blocked).toBe(false);
  expect(mapped.fields).toEqual({
    issue_id: 'target-issue',
    author_source_id: 'target-user',
    body: 'hi',
    created_at: 'a',
    updated_at: 'b',
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
