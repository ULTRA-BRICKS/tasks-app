import type { IssueCreate } from '@tickets/contracts';
export interface Draft {
  title: string;
  description: string;
  team_id: string;
  status_id: string;
  priority: number;
  assignee_id: string | null;
  project_id: string | null;
  cycle_id: string | null;
  parent_id: string | null;
  kind: 'issue' | 'epic';
  label_ids: string[];
  due_date: string | null;
  start_date?: string | null;
  estimate?: number | null;
  milestone_id?: string | null;
  attempt?: { key: string; input: IssueCreate };
}
export function newIssueDraft(input: Partial<IssueCreate> = {}): Draft {
  return {
    title: input.title ?? '',
    description: input.description ?? '',
    team_id: input.team_id ?? '',
    status_id: input.status_id ?? '',
    priority: input.priority ?? 0,
    assignee_id: input.assignee_id ?? null,
    project_id: input.project_id ?? null,
    cycle_id: input.cycle_id ?? null,
    parent_id: input.parent_id ?? null,
    kind: input.kind ?? 'issue',
    label_ids: [...(input.label_ids ?? [])],
    due_date: input.due_date ?? null,
    start_date: input.start_date ?? null,
    estimate: input.estimate ?? null,
    milestone_id: input.milestone_id ?? null,
  };
}
export function createIssueInput(d: Draft, team: string, status: string): IssueCreate {
  return {
    title: d.title.trim(),
    description: d.description,
    team_id: team,
    status_id: status,
    priority: d.priority,
    assignee_id: d.assignee_id,
    project_id: d.project_id,
    cycle_id: d.cycle_id,
    parent_id: d.parent_id,
    kind: d.kind,
    label_ids: [...d.label_ids],
    due_date: d.due_date,
    start_date: d.start_date ?? null,
    estimate: d.estimate ?? null,
    milestone_id: d.milestone_id ?? null,
  };
}
export function issueDraftKey(workspace: string, user: string, input: Partial<IssueCreate>) {
  return [
    'ticket-new',
    workspace,
    user,
    input.kind ?? 'issue',
    input.team_id ?? '',
    input.parent_id ?? '',
    input.project_id ?? '',
    input.cycle_id ?? '',
  ]
    .map(encodeURIComponent)
    .join(':');
}
