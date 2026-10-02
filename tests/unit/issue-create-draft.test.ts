import { test, expect } from 'bun:test';
import { newIssueDraft, createIssueInput, issueDraftKey } from '../../src/pages/issue-new/model';
test('creation preserves every property visible in the editor', () => {
  const draft = newIssueDraft({
    title: '  Ship it  ',
    description: '# Plan',
    estimate: 5,
    start_date: '2026-10-01',
    due_date: '2026-10-08',
    milestone_id: 'm1',
    project_id: 'p1',
    label_ids: ['l1'],
    kind: 'epic',
    priority: 2,
    assignee_id: 'u1',
    cycle_id: 'c1',
    parent_id: 'i1',
  });
  const result = createIssueInput(draft, 't1', 's1');
  expect(result).toEqual({
    title: 'Ship it',
    description: '# Plan',
    team_id: 't1',
    status_id: 's1',
    estimate: 5,
    start_date: '2026-10-01',
    due_date: '2026-10-08',
    milestone_id: 'm1',
    project_id: 'p1',
    label_ids: ['l1'],
    kind: 'epic',
    priority: 2,
    assignee_id: 'u1',
    cycle_id: 'c1',
    parent_id: 'i1',
  });
  draft.label_ids.push('l2');
  expect(result.label_ids).toEqual(['l1']);
});
test('empty drafts publish no undefined optional values and preserve zero estimate', () => {
  expect(createIssueInput(newIssueDraft({ estimate: 0 }), 't', 's')).toMatchObject({
    estimate: 0,
    start_date: null,
    milestone_id: null,
  });
});
test('issue and epic drafts cannot collide across users, workspaces or creation contexts', () => {
  const base = issueDraftKey('w', 'u', {});
  for (const input of [
    { kind: 'epic' as const },
    { team_id: 't' },
    { project_id: 'p' },
    { parent_id: 'i' },
    { cycle_id: 'c' },
  ])
    expect(issueDraftKey('w', 'u', input)).not.toBe(base);
  expect(issueDraftKey('other', 'u', {})).not.toBe(base);
  expect(issueDraftKey('w', 'other', {})).not.toBe(base);
});
