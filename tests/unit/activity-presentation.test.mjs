import { test, expect } from 'bun:test';
import {
  describeActivity,
  sourceReferences,
  presentActivities,
} from '../../packages/server/core/activity-presentation.mjs';
test('imported history names the actual change instead of its transport event', () => {
  const names = new Map([
    ['workflowStates:before', 'Backlog'],
    ['workflowStates:after', 'In progress'],
    ['users:author', 'Alex'],
  ]);
  expect(
    describeActivity(
      'linear_imported_change',
      { fromStateId: 'before', toStateId: 'after' },
      names,
    ),
  ).toBe('changed status from Backlog to In progress');
  expect(describeActivity('linear_imported_change', { toTitle: 'New title' })).toBe(
    'changed title to “New title”',
  );
  expect(describeActivity('linear_imported_change', { updatedDescription: true })).toBe(
    'updated the description',
  );
  expect(
    describeActivity(
      'linear_imported_change',
      { fromAssigneeId: 'author', toAssigneeId: null },
      names,
    ),
  ).toBe('removed the assignee');
  expect(describeActivity('linear_imported_change', { fromPriority: 0, toPriority: 2 })).toBe(
    'set priority to High',
  );
});
test('unrecognized and absent metadata stays human readable without invented details', () => {
  expect(describeActivity('linear_imported_change', {})).toBe('updated this issue in Linear');
  expect(
    describeActivity('linear_imported_change', { fromStateId: 'old-uuid', toStateId: 'new-uuid' }),
  ).toBe('changed status');
  expect(describeActivity('unknown_internal_action')).toBe('updated this issue');
  expect(
    describeActivity('updated', { title: { from: 'a', to: 'b' }, priority: { from: 1, to: 2 } }),
  ).toBe('changed title, priority');
  expect(sourceReferences({ addedLabelIds: 'invalid' })).toEqual([]);
});
test('presentation preserves the original event and scopes historical lookups', async () => {
  const calls = [];
  const tx = {
    all: async (sql, args) => {
      calls.push({ sql, args });
      return [{ collection: 'workflowStates', source_id: 'status-id', payload: '{"name":"Done"}' }];
    },
  };
  const data = JSON.stringify({ toStateId: 'status-id' });
  const rows = await presentActivities(tx, 'workspace-one', [
    { id: 'e', action: 'linear_imported_change', data },
  ]);
  expect(rows[0].summary).toBe('set status to Done');
  expect(rows[0].data).toEqual({ toStateId: 'status-id' });
  expect(calls).toHaveLength(1);
  expect(calls[0].args).toEqual(['workspace-one', 'status-id']);
  expect(calls[0].sql).toContain('r.workspace_id=?');
});
