import { collections } from '../../packages/imports/linear-source.mjs';
export function sourceFixture() {
  const ids = Object.fromEntries(
    [
      'org',
      'team',
      'user',
      'state',
      'label',
      'project',
      'milestone',
      'initiative',
      'issue',
      'child',
      'comment',
      'history',
      'relation',
      'document',
    ].map((k) => [k, crypto.randomUUID()]),
  );
  const time = {
    createdAt: '2024-01-02T03:04:05.006Z',
    updatedAt: '2024-02-03T04:05:06.007Z',
    archivedAt: null,
  };
  const data = Object.fromEntries(collections.map((c) => [c, []]));
  data.users = [
    { id: ids.user, name: 'Source author', email: 'source-only@example.test', ...time },
  ];
  data.teams = [{ id: ids.team, key: 'SRC', name: 'Source team', ...time }];
  data.workflowStates = [
    {
      id: ids.state,
      name: 'Todo',
      type: 'unstarted',
      color: '#777777',
      position: 1,
      team: { id: ids.team },
      ...time,
    },
  ];
  data.issueLabels = [{ id: ids.label, name: 'Imported fixture', color: '#123456', ...time }];
  data.projects = [
    {
      id: ids.project,
      name: 'Original project',
      content: 'Project body — αβ',
      status: { type: 'started' },
      lead: { id: ids.user },
      teams: { nodes: [{ id: ids.team }] },
      ...time,
    },
  ];
  data.projectMilestones = [
    { id: ids.milestone, name: 'Original milestone', project: { id: ids.project }, ...time },
  ];
  data.initiatives = [
    {
      id: ids.initiative,
      name: 'Original initiative',
      content: 'Initiative body',
      status: 'Active',
      owner: { id: ids.user },
      projects: { nodes: [{ id: ids.project }] },
      ...time,
    },
  ];
  const common = {
    description: 'Markdown\n\n- [ ] Preserve this текст → αβ',
    state: { id: ids.state },
    team: { id: ids.team },
    project: { id: ids.project },
    projectMilestone: { id: ids.milestone },
    creator: { id: ids.user },
    assignee: { id: ids.user },
    labelIds: [ids.label],
    priority: 2,
    ...time,
  };
  data.issues = [
    {
      ...common,
      id: ids.child,
      number: 8,
      identifier: 'SRC-8',
      title: 'Child',
      parent: { id: ids.issue },
      url: 'https://linear.app/example/issue/SRC-8',
    },
    {
      ...common,
      id: ids.issue,
      number: 7,
      identifier: 'SRC-7',
      title: 'Parent',
      url: 'https://linear.app/example/issue/SRC-7',
    },
  ];
  data.comments = [
    {
      id: ids.comment,
      issueId: ids.issue,
      user: { id: ids.user },
      body: 'Original comment\nКириллица',
      ...time,
    },
  ];
  data.issueRelations = [
    {
      id: ids.relation,
      issue: { id: ids.issue },
      relatedIssue: { id: ids.child },
      type: 'related',
      ...time,
    },
  ];
  data.issueHistory = [
    {
      id: ids.issue,
      history: {
        nodes: [
          { id: ids.history, actorId: ids.user, fromTitle: 'Old', toTitle: 'Parent', ...time },
        ],
      },
    },
  ];
  data.documents = [
    {
      id: ids.document,
      title: 'Original document',
      content: 'Full document '.repeat(9000),
      project: { id: ids.project },
      creator: { id: ids.user },
      ...time,
    },
  ];
  const manifest = {
    format: 'tickets-linear-snapshot-v1',
    organization: { id: ids.org, name: 'Synthetic Linear' },
    counts: Object.fromEntries(collections.map((c) => [c, data[c].length])),
    validationFindings: [],
    issueVerificationDrift: { added: [], removed: [], changed: [] },
  };
  return { ids, data, manifest };
}
/** The same source under another team key, so each browser project can import its own copy. */
export function teamSourceFixture(teamKey) {
  const source = sourceFixture();
  source.data.teams[0].key = teamKey;
  for (const issue of source.data.issues) issue.identifier = teamKey + '-' + issue.number;
  return source;
}
