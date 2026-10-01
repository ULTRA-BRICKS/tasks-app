import { collections, digest, targetId, uuid } from './linear-source.mjs';
import { safeAvatarUrl } from '../../src/shared/lib/canonical-people.mjs';
const stateKinds = new Set([
  'triage',
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
  'duplicate',
]);
const planStatus = {
  backlog: 'planned',
  planned: 'planned',
  started: 'in_progress',
  paused: 'paused',
  completed: 'completed',
  canceled: 'canceled',
};
const initiativeStatus = {
  Planned: 'planned',
  Active: 'active',
  Completed: 'completed',
  Canceled: 'canceled',
};
// Pure conversion only: this function neither connects to a database nor grants access.
export function projectSnapshot(snapshot, actor, { labelTargets = {} } = {}) {
  const { data, manifest } = snapshot;
  const workspace = actor.workspace_id,
    source = manifest.organization.id;
  if (!uuid(workspace) || !uuid(actor.id)) throw new Error('Invalid destination identifiers');
  const rows = [],
    mappings = [],
    warnings = [];
  const indexes = Object.fromEntries(
    collections.map((c) => [c, new Map((data[c] ?? []).map((x) => [x.id, x]))]),
  );
  const id = (c, v) => {
    if (v == null) return null;
    const sourceId = typeof v === 'string' ? v : v.id;
    return c === 'issueLabels' && Object.hasOwn(labelTargets, sourceId)
      ? labelTargets[sourceId].id
      : targetId(workspace, source, c, sourceId);
  };
  const ref = (c, v) => {
    if (v == null) return null;
    const key = typeof v === 'string' ? v : v.id;
    if (!indexes[c]?.has(key)) throw new Error('Unresolved ' + c + ' reference ' + key);
    return id(c, key);
  };
  const add = (table, row) => rows.push({ table, row: { workspace_id: workspace, ...row } });
  const sourcePerson = (v) => ref('users', v);
  const archived = (x) => x.archivedAt ?? null;
  const timestamp = (v, label) => {
    if (typeof v !== 'string' || !Number.isFinite(Date.parse(v)))
      throw new Error('Invalid timestamp: ' + label);
    return v;
  };
  const text = (v, label, limit = 100000) => {
    if (typeof v !== 'string' || v.length > limit) throw new Error('Invalid source text: ' + label);
    return v;
  };
  for (const user of data.users)
    add('source_people', {
      id: id('users', user),
      provider: 'linear',
      source_id: user.id,
      name: text(user.name ?? user.displayName ?? 'Unknown source author', 'person', 200),
      email: text(user.email, 'source person email required by Linear GraphQL', 254),
      avatar_url: safeAvatarUrl(user.avatarUrl),
      created_at: timestamp(user.createdAt, 'source person'),
    });
  for (const team of data.teams) {
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(team.key)) throw new Error('Unsupported team key');
    const numbers = data.issues.filter((x) => x.team?.id === team.id).map((x) => x.number);
    if (numbers.some((n) => !Number.isSafeInteger(n) || n < 1))
      throw new Error('Invalid issue number');
    add('teams', {
      id: id('teams', team),
      key: team.key,
      name: text(team.name, 'team', 100),
      next_number: Math.max(0, ...numbers) + 1,
    });
  }
  for (const state of data.workflowStates) {
    if (!stateKinds.has(state.type)) throw new Error('Unsupported workflow category ' + state.type);
    add('statuses', {
      id: id('workflowStates', state),
      team_id: ref('teams', state.team),
      name: text(state.name, 'status', 80),
      category: state.type === 'duplicate' ? 'canceled' : state.type,
      source_type: state.type,
      color: state.color,
      position: state.position ?? 0,
    });
  }
  for (const label of data.issueLabels)
    if (!Object.hasOwn(labelTargets, label.id))
      add('labels', {
        id: id('issueLabels', label),
        name: text(label.name, 'label', 80),
        color: label.color,
      });
  for (const project of data.projects) {
    if (!Object.hasOwn(planStatus, project.status?.type))
      throw new Error('Unsupported project status');
    add('projects', {
      id: id('projects', project),
      name: text(project.name, 'project', 200),
      description: text(project.content ?? project.description ?? '', 'project body'),
      status: planStatus[project.status.type],
      health: project.health ?? 'on_track',
      lead_id: null,
      lead_source_id: sourcePerson(project.lead),
      start_date: project.startDate ?? null,
      target_date: project.targetDate ?? null,
      version: 1,
      created_at: timestamp(project.createdAt, 'project'),
      updated_at: timestamp(project.updatedAt, 'project'),
      archived_at: archived(project),
    });
    for (const team of project.teams?.nodes ?? [])
      add('project_teams', { project_id: id('projects', project), team_id: ref('teams', team) });
  }
  for (const milestone of data.projectMilestones)
    add('milestones', {
      id: id('projectMilestones', milestone),
      project_id: ref('projects', milestone.project),
      name: text(milestone.name, 'milestone', 200),
      target_date: milestone.targetDate ?? null,
      position: milestone.sortOrder ?? 0,
    });
  for (const cycle of data.cycles)
    add('cycles', {
      id: id('cycles', cycle),
      team_id: ref('teams', cycle.team),
      name: text(cycle.name ?? 'Cycle ' + cycle.number, 'cycle', 200),
      start_date: cycle.startsAt?.slice(0, 10),
      end_date: cycle.endsAt?.slice(0, 10),
      version: 1,
    });
  for (const initiative of data.initiatives) {
    if (!Object.hasOwn(initiativeStatus, initiative.status))
      throw new Error('Unsupported initiative status');
    add('initiatives', {
      id: id('initiatives', initiative),
      name: text(initiative.name, 'initiative', 200),
      description: text(initiative.content ?? initiative.description ?? '', 'initiative body'),
      status: initiativeStatus[initiative.status],
      owner_id: null,
      owner_source_id: sourcePerson(initiative.owner),
      target_date: initiative.targetDate ?? null,
      version: 1,
      created_at: timestamp(initiative.createdAt, 'initiative'),
      updated_at: timestamp(initiative.updatedAt, 'initiative'),
      archived_at: archived(initiative),
    });
    for (const project of initiative.projects?.nodes ?? [])
      add('initiative_projects', {
        initiative_id: id('initiatives', initiative),
        project_id: ref('projects', project),
      });
  }
  const remaining = new Map(data.issues.map((x) => [x.id, x])),
    inserted = new Set();
  while (remaining.size) {
    const before = remaining.size;
    for (const [key, issue] of remaining) {
      if (issue.parent && !inserted.has(issue.parent.id)) {
        ref('issues', issue.parent);
        continue;
      }
      const state = indexes.workflowStates.get(issue.state?.id);
      if (state?.team?.id !== issue.team?.id)
        throw new Error('Issue state belongs to another team');
      if (!Number.isInteger(issue.priority) || issue.priority < 0 || issue.priority > 4)
        throw new Error('Invalid priority');
      add('issues', {
        id: id('issues', issue),
        team_id: ref('teams', issue.team),
        number: issue.number,
        key: issue.identifier,
        title: text(issue.title, 'issue title', 300),
        description: text(issue.description ?? '', 'issue body'),
        kind: 'issue',
        status_id: ref('workflowStates', issue.state),
        priority: issue.priority,
        creator_id: actor.id,
        creator_source_id: sourcePerson(issue.creator),
        assignee_id: null,
        assignee_source_id: sourcePerson(issue.assignee),
        project_id: ref('projects', issue.project),
        cycle_id: ref('cycles', issue.cycle),
        milestone_id: ref('projectMilestones', issue.projectMilestone),
        parent_id: ref('issues', issue.parent),
        estimate: issue.estimate ?? null,
        start_date: null,
        due_date: issue.dueDate ?? null,
        position: issue.sortOrder ?? issue.number,
        version: 1,
        created_at: timestamp(issue.createdAt, 'issue'),
        updated_at: timestamp(issue.updatedAt, 'issue'),
        archived_at: archived(issue),
        deleted_at: issue.trashed ? issue.updatedAt : null,
      });
      for (const label of issue.labelIds ?? [])
        add('issue_labels', { issue_id: id('issues', issue), label_id: ref('issueLabels', label) });
      add('external_links', {
        id: id('linear-link', issue),
        issue_id: id('issues', issue),
        provider: 'linear',
        external_id: issue.id,
        url: issue.url,
        title: issue.identifier,
      });
      inserted.add(key);
      remaining.delete(key);
    }
    if (remaining.size === before) throw new Error('Cyclic issue hierarchy');
  }
  for (const document of data.documents)
    add('documents', {
      id: id('documents', document),
      title: text(document.title, 'document title', 300),
      body: text(document.content ?? '', 'document body', 500000),
      project_id: ref('projects', document.project),
      initiative_id: ref('initiatives', document.initiative),
      creator_id: actor.id,
      creator_source_id: sourcePerson(document.creator),
      version: 1,
      created_at: timestamp(document.createdAt, 'document'),
      updated_at: timestamp(document.updatedAt, 'document'),
      archived_at: archived(document),
    });
  for (const comment of data.comments) {
    if (!comment.issueId)
      throw new Error('Non-issue comments require knowledge-comment support before import');
    add('comments', {
      id: id('comments', comment),
      issue_id: ref('issues', comment.issueId),
      author_id: actor.id,
      author_source_id: sourcePerson(comment.user),
      body: text(comment.body, 'comment', 50000),
      created_at: timestamp(comment.createdAt, 'comment'),
      updated_at: timestamp(comment.updatedAt, 'comment'),
      version: 1,
    });
  }
  for (const relation of data.issueRelations) {
    if (!['related', 'blocks', 'duplicate'].includes(relation.type))
      throw new Error('Unknown source relation');
    add('relations', {
      id: id('issueRelations', relation),
      source_id: ref('issues', relation.issue),
      target_id: ref('issues', relation.relatedIssue),
      type: relation.type === 'duplicate' ? 'duplicates' : relation.type,
    });
  }
  for (const record of data.issueHistory)
    for (const event of record.history.nodes) {
      const person =
        event.actorId && indexes.users.has(event.actorId) ? sourcePerson(event.actorId) : null;
      add('activity', {
        id: id('history-event', event),
        issue_id: ref('issues', record.id),
        actor_id: actor.id,
        actor_source_id: person,
        action: 'linear_imported_change',
        data: JSON.stringify(event),
        created_at: timestamp(event.createdAt, 'history'),
      });
    }
  for (const attachment of data.attachments) {
    if (!attachment.issue) throw new Error('Attachment is missing its source issue');
    const url = new URL(attachment.url);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Unsafe source attachment URL');
    add('external_links', {
      id: id('attachments', attachment),
      issue_id: ref('issues', attachment.issue),
      provider: 'linear_attachment',
      external_id: attachment.id,
      url: url.href,
      title: text(
        attachment.title ?? attachment.subtitle ?? 'Source attachment',
        'attachment title',
        500,
      ),
    });
  }
  for (const collection of collections)
    for (const record of data[collection])
      mappings.push({
        collection,
        source_id: record.id,
        target_id: id(collection, record),
        payload_hash: digest(record),
      });
  for (const collection of [
    'projectRelations',
    'initiativeRelations',
    'projectUpdates',
    'initiativeUpdates',
  ]) {
    if (data[collection].length)
      throw new Error('Native support required before applying nonempty ' + collection);
  }
  const reusedLabels = data.issueLabels
    .filter((label) => Object.hasOwn(labelTargets, label.id))
    .map((label) => ({
      source_id: label.id,
      target_id: labelTargets[label.id].id,
      name: label.name,
      source_color: label.color,
      target_color: labelTargets[label.id].color,
    }));
  const privateAssets = new Set();
  const scan = (value) => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/https:\/\/uploads\.linear\.app\/[^\s)<>"\]]+/g))
        privateAssets.add(match[0]);
    } else if (Array.isArray(value)) value.forEach(scan);
    else if (value && typeof value === 'object') Object.values(value).forEach(scan);
  };
  for (const collection of [
    'issues',
    'comments',
    'projects',
    'documents',
    'initiatives',
    'attachments',
  ])
    data[collection].forEach(scan);
  const counts = {};
  for (const { table, row } of rows) {
    counts[table] = (counts[table] ?? 0) + 1;
    if (Object.values(row).some((v) => typeof v === 'number' && !Number.isFinite(v)))
      throw new Error('Nonfinite native value');
    if (Object.values(row).some((v) => typeof v === 'string' && v.includes('\0')))
      throw new Error('NUL byte cannot be represented by target PostgreSQL');
  }
  warnings.push(
    'Imported source people are attribution only, without accounts or login privileges.',
  );
  warnings.push(
    'Extra source fields, original role/member mappings, reactions and history are retained in immutable source records.',
  );
  return {
    rows,
    mappings,
    counts,
    reusedLabels,
    privateAssets: [...privateAssets].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    warnings,
    hash: digest({ source, workspace, actor: actor.id, rows, mappings, reusedLabels }),
  };
}
