import { describe, expect, test } from 'bun:test';
import type { Issue } from '@tickets/contracts';
import { recordableChange, serverValueText } from '../../src/features/issue-edit/history-model';

const issue = (overrides: Partial<Issue> = {}): Issue => ({
  id: 'task-1',
  workspace_id: 'w',
  team_id: 't',
  key: 'ENG-1',
  number: 1,
  title: 'Title',
  description: 'Body',
  kind: 'issue',
  status_id: 'todo',
  status_name: 'Todo',
  status_category: 'unstarted',
  status_color: '#999',
  priority: 3,
  assignee_id: null,
  assignee_name: null,
  creator_id: 'u',
  project_id: null,
  project_name: null,
  cycle_id: null,
  milestone_id: null,
  parent_id: null,
  estimate: null,
  start_date: null,
  due_date: null,
  position: 1,
  version: 4,
  created_at: '',
  updated_at: '',
  archived_at: null,
  deleted_at: null,
  labels: [],
  label_ids: [],
  ...overrides,
});

describe('record', () => {
  test('a saved property patch records its previous and new values', () => {
    expect(recordableChange(issue(), { status_id: 'done', priority: 1 })).toEqual({
      entityId: 'task-1',
      label: 'Status and priority',
      before: { status_id: 'todo', priority: 3 },
      after: { status_id: 'done', priority: 1 },
    });
  });
  test('text, ordering and lifecycle fields are left to their own flows', () => {
    expect(
      recordableChange(issue(), { title: 'New', description: 'New body', position: 9 }),
    ).toBeNull();
    expect(recordableChange(issue(), { archived: true })).toBeNull();
    expect(recordableChange(issue(), { title: 'New', assignee_id: 'u-2' })).toEqual({
      entityId: 'task-1',
      label: 'Assignee',
      before: { assignee_id: null },
      after: { assignee_id: 'u-2' },
    });
  });
  test('a patch that changes nothing records nothing; reordered labels are no change', () => {
    expect(recordableChange(issue({ status_id: 'done' }), { status_id: 'done' })).toBeNull();
    expect(
      recordableChange(issue({ label_ids: ['a', 'b'] }), { label_ids: ['b', 'a'] }),
    ).toBeNull();
    expect(recordableChange(issue({ label_ids: ['a'] }), { label_ids: ['a', 'b'] })).toEqual({
      entityId: 'task-1',
      label: 'Labels',
      before: { label_ids: ['a'] },
      after: { label_ids: ['a', 'b'] },
    });
  });
});

describe('server value', () => {
  test('conflict notices name the current server value in words', () => {
    const current = issue({
      status_name: 'In Progress',
      assignee_name: null,
      project_name: 'Launch',
      labels: [
        { id: 'a', name: 'Bug', color: '#f00' },
        { id: 'b', name: 'UI', color: '#0f0' },
      ] as Issue['labels'],
      priority: 1,
      due_date: '2026-10-01',
    });
    expect(serverValueText('status_id', current)).toBe('In Progress');
    expect(serverValueText('assignee_id', current)).toBe('Unassigned');
    expect(serverValueText('project_id', current)).toBe('Launch');
    expect(serverValueText('label_ids', current)).toBe('Bug, UI');
    expect(serverValueText('label_ids', issue())).toBe('No labels');
    expect(serverValueText('priority', current)).toBe('Urgent');
    expect(serverValueText('due_date', current)).toBe('2026-10-01');
    expect(serverValueText('due_date', issue())).toBe('No date');
  });
  test('fields without a readable name report no value', () => {
    expect(serverValueText('cycle_id', issue({ cycle_id: 'c-1' }))).toBeNull();
  });
});
