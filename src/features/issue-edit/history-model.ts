/**
 * Recorded history of saved task property changes (docs/KEYBOARD-COMMANDS.md, B5). Native text
 * undo stays with the focused field; this history holds the property PATCHes this tab saved.
 */
import { create } from 'zustand';
import type { Issue, IssuePatch } from '@tickets/contracts';
import { priorities } from '@/entities/issue';
import {
  recordChange,
  sameFieldValue,
  type DomainChange,
  type DomainHistory,
} from '@/shared/lib/domain-history';

/** Properties that undo covers; title and description keep their own editor undo and drafts. */
export const undoable = {
  status_id: 'Status',
  priority: 'Priority',
  assignee_id: 'Assignee',
  project_id: 'Project',
  cycle_id: 'Cycle',
  milestone_id: 'Milestone',
  parent_id: 'Parent',
  estimate: 'Estimate',
  start_date: 'Start date',
  due_date: 'Due date',
  label_ids: 'Labels',
  kind: 'Type',
} as const;
type UndoableField = keyof typeof undoable;
export type IssueValues = Partial<Pick<Issue, UndoableField>>;
export const isUndoable = (field: string): field is UndoableField => Object.hasOwn(undoable, field);
const fieldList = new Intl.ListFormat('en', { type: 'conjunction' });
function copyField<K extends UndoableField>(target: IssueValues, source: IssueValues, field: K) {
  target[field] = source[field];
}
function pickFields(source: IssueValues, fields: readonly UndoableField[]): IssueValues {
  const picked: IssueValues = {};
  for (const field of fields) copyField(picked, source, field);
  return picked;
}

/** The undoable part of a saved patch, or null when it changed none of those properties. */
export function recordableChange(
  issue: Issue,
  patch: Omit<IssuePatch, 'version'>,
): DomainChange<IssueValues> | null {
  const fields = Object.keys(patch)
    .filter(isUndoable)
    .filter((field) => !sameFieldValue(issue[field], patch[field]));
  if (!fields.length) return null;
  return {
    entityId: issue.id,
    label: fieldList.format(
      fields.map((field, index) => (index ? undoable[field].toLowerCase() : undoable[field])),
    ),
    before: pickFields(issue, fields),
    after: pickFields(patch, fields),
  };
}

/** The server's current value of a property in words, or null when it has no readable name. */
export function serverValueText(field: string, issue: Issue): string | null {
  switch (field) {
    case 'status_id':
      return issue.status_name;
    case 'assignee_id':
      return issue.assignee_name ?? 'Unassigned';
    case 'project_id':
      return issue.project_name ?? 'No project';
    case 'label_ids':
      return issue.labels.map((label) => label.name).join(', ') || 'No labels';
    case 'priority':
      return priorities[issue.priority]?.label ?? 'No priority';
    case 'start_date':
    case 'due_date':
      return issue[field] ?? 'No date';
    case 'estimate':
      return issue.estimate === null ? 'No estimate' : String(issue.estimate);
    case 'kind':
      return issue.kind === 'epic' ? 'Epic' : 'Task';
    default:
      return null;
  }
}

export type Notice = { text: string; tone: 'status' | 'alert' };
export const useHistoryStore = create<{
  history: DomainHistory<IssueValues>;
  /** One step at a time: a second press while a step is in flight would replay it. */
  busy: boolean;
  notice: Notice | null;
}>()(() => ({ history: { undo: [], redo: [] }, busy: false, notice: null }));

/** Called when a property PATCH succeeds; a new change clears redo. */
export function recordIssueChange(issue: Issue, patch: Omit<IssuePatch, 'version'>) {
  const change = recordableChange(issue, patch);
  if (change) useHistoryStore.setState((s) => ({ history: recordChange(s.history, change) }));
}
