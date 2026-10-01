import { assert } from '../../core/errors.mjs';
import { safeAvatarUrl } from '../../../../src/shared/lib/canonical-people.mjs';

export const TABLES = Object.freeze({
  issues: 'issues',
  comments: 'comments',
  teams: 'teams',
  workflowStates: 'statuses',
  issueLabels: 'labels',
  users: 'source_people',
  projects: 'projects',
  projectMilestones: 'milestones',
  cycles: 'cycles',
  documents: 'documents',
  initiatives: 'initiatives',
  issueRelations: 'relations',
  attachments: 'external_links',
  projectUpdates: 'documents',
  initiativeUpdates: 'documents',
});
const refKeys = {
  team: 'teams',
  state: 'workflowStates',
  assignee: 'users',
  creator: 'users',
  user: 'users',
  owner: 'users',
  lead: 'users',
  project: 'projects',
  initiative: 'initiatives',
  projectMilestone: 'projectMilestones',
  cycle: 'cycles',
  parent: 'issues',
  issue: 'issues',
  relatedIssue: 'issues',
};
export function sourceReferences(collection, record) {
  const result = [];
  for (const [field, kind] of Object.entries(refKeys))
    if (record?.[field]?.id) {
      if (field === 'parent' && collection === 'comments') continue;
      result.push({ collection: kind, id: record[field].id });
    }
  for (const key of record?.labelIds ?? []) result.push({ collection: 'issueLabels', id: key });
  for (const team of record?.teams?.nodes ?? []) result.push({ collection: 'teams', id: team.id });
  for (const project of record?.projects?.nodes ?? [])
    result.push({ collection: 'projects', id: project.id });
  if (record?.issueId) result.push({ collection: 'issues', id: record.issueId });
  return result;
}
const sorted = (items) => [...new Set(items)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const day = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);
export function normalizedSource(collection, s, resolve) {
  const ref = (kind, value) =>
    value == null ? null : resolve(kind, typeof value === 'string' ? value : value.id);
  const body = s.content ?? s.description ?? '';
  if (collection === 'issues') {
    assert(
      typeof s.title === 'string' &&
        s.title.trim() &&
        s.title.length <= 300 &&
        Array.isArray(s.labelIds) &&
        s.labelIds.length <= 100 &&
        Number.isInteger(s.priority) &&
        s.priority >= 0 &&
        s.priority <= 4,
      422,
      'SOURCE_ISSUE_INVALID',
      'Source issue violates native bounds',
    );
    return {
      title: s.title,
      description: s.description ?? '',
      team_id: ref('teams', s.team),
      status_id: ref('workflowStates', s.state),
      priority: s.priority,
      assignee_id: ref('users', s.assignee),
      project_id: ref('projects', s.project),
      cycle_id: ref('cycles', s.cycle),
      milestone_id: ref('projectMilestones', s.projectMilestone),
      parent_id: ref('issues', s.parent),
      estimate: s.estimate ?? null,
      due_date: s.dueDate ?? null,
      label_ids: sorted(s.labelIds.map((key) => ref('issueLabels', key))),
      archived: Boolean(s.archivedAt),
    };
  }
  if (collection === 'comments')
    return { body: s.body, issue_id: ref('issues', s.issue ?? s.issueId) };
  if (collection === 'teams') return { key: s.key, name: s.name };
  if (collection === 'workflowStates')
    return {
      name: s.name,
      category: s.type === 'duplicate' ? 'canceled' : s.type,
      color: s.color,
      position: s.position,
      team_id: ref('teams', s.team),
    };
  if (collection === 'issueLabels') return { name: s.name, color: s.color };
  if (collection === 'users')
    return { name: s.name, email: s.email ?? null, avatar_url: safeAvatarUrl(s.avatarUrl) };
  if (collection === 'projects') {
    assert(
      ['backlog', 'planned', 'started', 'paused', 'completed', 'canceled'].includes(s.status?.type),
      422,
      'SYNC_PROJECT_STATUS_INVALID',
      'Source project status is missing or unsupported',
    );
    return {
      name: s.name,
      description: body,
      status: {
        backlog: 'planned',
        planned: 'planned',
        started: 'in_progress',
        paused: 'paused',
        completed: 'completed',
        canceled: 'canceled',
      }[s.status?.type],
      health: s.health ?? 'on_track',
      lead_id: ref('users', s.lead),
      start_date: s.startDate ?? null,
      target_date: s.targetDate ?? null,
      team_ids: sorted(s.teams.nodes.map((t) => ref('teams', t))),
      archived: Boolean(s.archivedAt),
    };
  }
  if (collection === 'projectMilestones')
    return {
      name: s.name,
      project_id: ref('projects', s.project),
      target_date: s.targetDate ?? null,
      position: s.sortOrder ?? 0,
    };
  if (collection === 'cycles')
    return {
      name: s.name ?? 'Cycle ' + s.number,
      team_id: ref('teams', s.team),
      start_date: day(s.startsAt),
      end_date: day(s.endsAt),
    };
  if (collection === 'documents')
    return {
      title: s.title,
      body: s.content ?? '',
      project_id: ref('projects', s.project),
      initiative_id: ref('initiatives', s.initiative),
      archived: Boolean(s.archivedAt),
    };
  if (collection === 'initiatives')
    return {
      name: s.name,
      description: body,
      status: (() => {
        const statuses = {
          Active: 'active',
          Planned: 'planned',
          Proposed: 'planned',
          Completed: 'completed',
          Canceled: 'canceled',
        };
        assert(
          Object.hasOwn(statuses, s.status),
          422,
          'SOURCE_INITIATIVE_STATUS',
          'Unknown source initiative status',
        );
        return statuses[s.status];
      })(),
      target_date: s.targetDate ?? null,
      owner_id: ref('users', s.owner),
      project_ids: sorted(s.projects.nodes.map((p) => ref('projects', p))),
      archived: Boolean(s.archivedAt),
    };
  if (collection === 'issueRelations') {
    let a = ref('issues', s.issue),
      b = ref('issues', s.relatedIssue);
    if (s.type === 'related' && a > b) [a, b] = [b, a];
    return { source_id: a, target_id: b, type: s.type === 'duplicate' ? 'duplicates' : s.type };
  }
  if (collection === 'attachments')
    return { issue_id: ref('issues', s.issue), title: s.title, url: s.url };
  if (collection === 'projectUpdates' || collection === 'initiativeUpdates')
    return {
      body: s.body,
      project_id: ref('projects', s.project),
      initiative_id: ref('initiatives', s.initiative),
      archived: Boolean(s.archivedAt),
    };
  assert(false, 422, 'SOURCE_MODEL_UNSUPPORTED', 'Unknown synchronization model');
}
