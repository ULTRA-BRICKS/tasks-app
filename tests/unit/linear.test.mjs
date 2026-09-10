import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
const gql = (f, query, variables = {}, options = {}) =>
  f.request('POST', '/graphql', { query, variables }, options);
test('Linear GraphQL uses upstream query names, nullability and shared ticket storage', async () => {
  const f = await fixture();
  try {
    const r = await gql(
      f,
      'mutation($input:IssueCreateInput!){issueCreate(input:$input){success issue{id identifier title priority state{id name type} team{id key} creator{id}}}}',
      { input: { teamId: f.init.team_id, title: 'GraphQL task', priority: 2 } },
    );
    expect(r.status).toBe(200);
    expect(r.data.errors).toBeUndefined();
    expect(r.data.data.issueCreate.success).toBe(true);
    const issue = r.data.data.issueCreate.issue;
    expect(issue.identifier).toBe('TKT-1');
    expect(issue.priority).toBe(2);
    expect(issue.creator.id).toBe(f.init.user_id);
    expect((await f.request('GET', '/api/v1/issues/' + issue.id)).data.title).toBe('GraphQL task');
    const q = await gql(
      f,
      'query($id:String!){issue(id:$id){id description assignee{id} dueDate labels{nodes{id}}}}',
      { id: issue.identifier },
    );
    expect(q.data.errors).toBeUndefined();
    expect(q.data.data.issue.assignee).toBeNull();
  } finally {
    await f.close();
  }
});
test('GraphQL authenticates raw Linear-style personal tokens and enforces read-only scopes', async () => {
  const f = await fixture();
  try {
    const t = (await f.request('POST', '/api/v1/tokens', { name: 'linear read', scopes: ['read'] }))
      .data.token;
    const opts = { anonymous: true, noCsrf: true, headers: { authorization: t } };
    const r = await gql(f, '{viewer{id name isMe} teams{nodes{id key}}}', {}, opts);
    expect(r.status).toBe(200);
    expect(r.data.errors).toBeUndefined();
    expect(r.data.data.viewer.isMe).toBe(true);
    const denied = await gql(
      f,
      'mutation($input:IssueCreateInput!){issueCreate(input:$input){success}}',
      { input: { teamId: f.init.team_id, title: 'Forbidden' } },
      opts,
    );
    expect(denied.data.errors[0].extensions.type).toBe('forbidden');
    expect((await f.request('GET', '/api/v1/issues')).data.data).toHaveLength(0);
  } finally {
    await f.close();
  }
});
test('GraphQL rejects unsupported fields and inputs rather than silently ignoring them', async () => {
  const f = await fixture();
  try {
    const r = await gql(f, '{viewer{id unknownField}}');
    expect(r.data.errors).toBeDefined();
    expect(r.data.data).toBeUndefined();
    const m = await gql(
      f,
      'mutation($input:IssueCreateInput!){issueCreate(input:$input){success}}',
      { input: { teamId: f.init.team_id, title: 'Bad', delegateId: 'unsupported' } },
    );
    expect(m.data.errors).toBeDefined();
    expect((await f.request('GET', '/api/v1/issues')).data.data).toHaveLength(0);
  } finally {
    await f.close();
  }
});
test('GraphQL paginates forward and backward with scoped tamper-proof cursors', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 5; i++) await f.create({ title: 'Item ' + i });
    const query =
      'query($first:Int,$last:Int,$after:String,$before:String){issues(first:$first,last:$last,after:$after,before:$before){nodes{id title} edges{cursor node{id}} pageInfo{startCursor endCursor hasNextPage hasPreviousPage}}}';
    const a = (await gql(f, query, { first: 2 })).data.data.issues;
    expect(a.nodes).toHaveLength(2);
    expect(a.pageInfo.hasNextPage).toBe(true);
    expect(a.pageInfo.hasPreviousPage).toBe(false);
    const b = (await gql(f, query, { first: 2, after: a.pageInfo.endCursor })).data.data.issues;
    expect(b.nodes).toHaveLength(2);
    expect(b.nodes[0].id).not.toBe(a.nodes[0].id);
    const c = (await gql(f, query, { last: 2, before: b.pageInfo.startCursor })).data.data.issues;
    expect(c.nodes).toEqual(a.nodes);
    const invalid = await gql(f, query, { first: 2, after: a.pageInfo.endCursor + 'x' });
    expect(invalid.data.errors).toBeDefined();
  } finally {
    await f.close();
  }
});
test('GraphQL filters labels and nested state, preserves dates, and updates without non-Linear version argument', async () => {
  const f = await fixture();
  try {
    const label = f.catalog.labels[0].id;
    const a = (await f.create({ title: 'Bug', label_ids: [label] })).data;
    await f.create({ title: 'Other' });
    const q = await gql(
      f,
      'query($label:ID!){issues(filter:{labels:{some:{id:{eq:$label}}},state:{type:{eq:"unstarted"}}}){nodes{id title}}}',
      { label },
    );
    expect(q.data.errors).toBeUndefined();
    expect(q.data.data.issues.nodes).toHaveLength(1);
    const r = await gql(
      f,
      'mutation($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success issue{title dueDate labels{nodes{id}}}}}',
      { id: a.id, input: { title: 'Changed', dueDate: '2026-09-25', labelIds: [] } },
    );
    expect(r.data.errors).toBeUndefined();
    expect(r.data.data.issueUpdate.issue.dueDate).toBe('2026-09-25');
    expect(r.data.data.issueUpdate.issue.labels.nodes).toHaveLength(0);
  } finally {
    await f.close();
  }
});
const caseWithDb = (name, fn) =>
  test(name, async () => {
    const f = await fixture();
    try {
      await fn(f);
    } finally {
      await f.close();
    }
  });
caseWithDb(
  'GraphQL enforces cookie CSRF, origin, authentication, methods and body limits',
  async (f) => {
    expect((await gql(f, '{viewer{id}}', {}, { noCsrf: true })).status).toBe(403);
    expect(
      (await gql(f, '{viewer{id}}', {}, { headers: { origin: 'https://evil.example' } })).status,
    ).toBe(403);
    expect((await gql(f, '{viewer{id}}', {}, { anonymous: true })).status).toBe(401);
    expect((await f.request('GET', '/graphql')).status).toBe(405);
    expect(
      (await gql(f, '{viewer{id}}', {}, { headers: { 'content-type': 'text/plain' } })).status,
    ).toBe(415);
    expect((await gql(f, '{viewer{id}}', { padding: 'x'.repeat(66000) })).status).toBe(413);
  },
);
caseWithDb('GraphQL handles operationName, aliases, fragments and directives', async (f) => {
  const query =
    'query A { viewer { id } } query B($hide:Boolean!){me:viewer{...UserName email @skip(if:$hide)}} fragment UserName on User{id name}';
  const missing = await f.request('POST', '/graphql', { query });
  expect(missing.data.errors).toBeDefined();
  const r = await f.request('POST', '/graphql', {
    query,
    operationName: 'B',
    variables: { hide: true },
  });
  expect(r.data.errors).toBeUndefined();
  expect(r.data.data.me).toEqual({ id: f.init.user_id, name: 'Owner' });
});
caseWithDb('GraphQL budgets fragment-hidden fanout before executing SQL', async (f) => {
  const q =
    '{issues(first:100){...I}} fragment I on IssueConnection{nodes{children(first:100){nodes{children(first:100){nodes{id title}}}}}}';
  const r = await gql(f, q);
  expect(r.data.errors[0].extensions.code).toBe('QUERY_COMPLEXITY');
  const cycle = await gql(f, '{viewer{...A}} fragment A on User{...A}');
  expect(cycle.data.errors).toBeDefined();
});
caseWithDb(
  'GraphQL rejects impossible dates, invalid page sizes and SQL injection filters',
  async (f) => {
    const a = (await f.create()).data;
    for (const date of ['2026-02-30', '2026-13-01', 'not-a-date']) {
      const r = await gql(
        f,
        'mutation($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success}}',
        { id: a.id, input: { dueDate: date } },
      );
      expect(r.data.errors).toBeDefined();
    }
    for (const vars of [{ first: -1 }, { last: 101 }, { first: 1, last: 1 }])
      expect(
        (
          await gql(
            f,
            'query($first:Int,$last:Int){issues(first:$first,last:$last){nodes{id}}}',
            vars,
          )
        ).data.errors,
      ).toBeDefined();
    const q = await gql(
      f,
      'query($needle:String!){issues(filter:{title:{contains:$needle}}){nodes{id}}}',
      { needle: "' OR 1=1 --" },
    );
    expect(q.data.data.issues.nodes).toHaveLength(0);
    expect((await f.request('GET', '/api/v1/issues/' + a.id)).data.version).toBe(1);
  },
);
caseWithDb(
  'GraphQL nested null predicates include unassigned issues and match labels on the same row',
  async (f) => {
    const [a, b] = f.catalog.labels;
    const one = (await f.create({ title: 'Unassigned', label_ids: [a.id, b.id] })).data;
    await f.create({ title: 'Assigned', assignee_id: f.init.user_id });
    const q = await gql(
      f,
      'query($id:ID!){issues(filter:{assignee:{or:[{null:true},{id:{eq:$id}}]}}){nodes{id}}}',
      { id: f.init.user_id },
    );
    expect(q.data.data.issues.nodes).toHaveLength(2);
    const mix = await gql(
      f,
      'query($id:ID!,$name:String!){issues(filter:{labels:{id:{eq:$id},name:{eq:$name}}}){nodes{id}}}',
      { id: a.id, name: b.name },
    );
    expect(mix.data.data.issues.nodes).toHaveLength(0);
    const empty = await gql(f, '{issues(filter:{labels:{null:true}}){nodes{title}}}');
    expect(empty.data.data.issues.nodes).toEqual([{ title: 'Assigned' }]);
    expect(one.label_ids).toHaveLength(2);
  },
);
caseWithDb('GraphQL project and milestone mutations use the same domain invariants', async (f) => {
  const p = await gql(
    f,
    'mutation($i:ProjectCreateInput!){projectCreate(input:$i){success project{id name teams{nodes{id}} url}}}',
    { i: { name: 'Graph release', teamIds: [f.init.team_id], leadId: f.init.user_id } },
  );
  expect(p.data.errors).toBeUndefined();
  const project = p.data.data.projectCreate.project;
  expect(project.teams.nodes[0].id).toBe(f.init.team_id);
  const m = await gql(
    f,
    'mutation($i:ProjectMilestoneCreateInput!){projectMilestoneCreate(input:$i){projectMilestone{id project{id}} success}}',
    { i: { name: 'Beta', projectId: project.id, targetDate: '2026-10-01' } },
  );
  expect(m.data.errors).toBeUndefined();
  const a = await gql(
    f,
    'mutation($i:IssueCreateInput!){issueCreate(input:$i){success issue{id project{id} projectMilestone{id}}}}',
    {
      i: {
        title: 'Ship beta',
        teamId: f.init.team_id,
        projectId: project.id,
        projectMilestoneId: m.data.data.projectMilestoneCreate.projectMilestone.id,
      },
    },
  );
  expect(a.data.errors).toBeUndefined();
  const wrong = await gql(f, 'mutation($i:IssueCreateInput!){issueCreate(input:$i){success}}', {
    i: {
      title: 'Invalid milestone',
      teamId: f.init.team_id,
      projectMilestoneId: m.data.data.projectMilestoneCreate.projectMilestone.id,
    },
  });
  expect(wrong.data.errors).toBeDefined();
});
caseWithDb(
  'GraphQL relations reject cycles, comments remain private after issue deletion',
  async (f) => {
    const a = (await f.create()).data,
      b = (await f.create()).data;
    const relation =
      'mutation($i:IssueRelationCreateInput!){issueRelationCreate(input:$i){success issueRelation{id type issue{id} relatedIssue{id}}}}';
    const r = await gql(f, relation, {
      i: { issueId: a.id, relatedIssueId: b.id, type: 'blocks' },
    });
    expect(r.data.errors).toBeUndefined();
    expect(
      (await gql(f, relation, { i: { issueId: b.id, relatedIssueId: a.id, type: 'blocks' } })).data
        .errors,
    ).toBeDefined();
    const comment = await gql(
      f,
      'mutation($i:CommentCreateInput!){commentCreate(input:$i){success comment{id body user{id}}}}',
      { i: { issueId: a.id, body: '# Signed off' } },
    );
    expect(comment.data.errors).toBeUndefined();
    const cid = comment.data.data.commentCreate.comment.id;
    expect(
      (await gql(f, 'mutation($id:String!){issueDelete(id:$id){success}}', { id: a.id })).data.data
        .issueDelete.success,
    ).toBe(true);
    const hidden = await gql(f, 'query($id:String!){comment(id:$id){id}}', { id: cid });
    expect(hidden.data.errors).toBeDefined();
    expect((await gql(f, '{comments{nodes{id}} issueRelations{nodes{id}}}')).data.data).toEqual({
      comments: { nodes: [] },
      issueRelations: { nodes: [] },
    });
  },
);
caseWithDb(
  'GraphQL archive/unarchive, label deltas and parent hierarchy are durable',
  async (f) => {
    const a = (await f.create()).data;
    const q = 'mutation($id:String!){issueArchive(id:$id){success entity{id archivedAt}}}';
    const r = await gql(f, q, { id: a.id });
    expect(r.data.errors).toBeUndefined();
    expect(r.data.data.issueArchive.entity.archivedAt).toBeTruthy();
    expect((await gql(f, '{issues{nodes{id}}}')).data.data.issues.nodes).toHaveLength(0);
    expect(
      (await gql(f, '{issues(includeArchived:true){nodes{id}}}')).data.data.issues.nodes,
    ).toHaveLength(1);
    expect(
      (
        await gql(f, 'mutation($id:String!){issueUnarchive(id:$id){success entity{archivedAt}}}', {
          id: a.id,
        })
      ).data.data.issueUnarchive.entity.archivedAt,
    ).toBeNull();
    const add = await gql(
      f,
      'mutation($id:String!,$label: String!){issueAddLabel(id:$id,labelId:$label){success issue{labelIds}}}',
      { id: a.id, label: f.catalog.labels[0].id },
    );
    expect(add.data.errors).toBeUndefined();
    expect(add.data.data.issueAddLabel.issue.labelIds).toHaveLength(1);
    const own = await gql(
      f,
      'mutation($id:String!){issueUpdate(id:$id,input:{parentId:$id}){success}}',
      { id: a.id },
    );
    expect(own.data.errors).toBeDefined();
  },
);
caseWithDb(
  'GraphQL uses one schema for every advertised field and never exposes credential fields',
  async (f) => {
    const r = await gql(
      f,
      '{__type(name:"User"){fields{name}} __schema{mutationType{fields{name}}}}',
    );
    expect(r.data.errors).toBeUndefined();
    const names = r.data.data.__type.fields.map((x) => x.name);
    expect(names).not.toContain('password_hash');
    expect(names).not.toContain('passwordHash');
    const { getLinearSchema } = await import('../../packages/linear/handler.mjs');
    const { buildSchema } = await import('graphql');
    const { readFileSync } = await import('node:fs');
    const up = buildSchema(
      readFileSync(new URL('../../vendor/linear/schema.graphql', import.meta.url), 'utf8'),
    );
    for (const [name, type] of Object.entries(getLinearSchema().getTypeMap())) {
      if (name.startsWith('__')) continue;
      for (const [field, supported] of Object.entries(type.getFields?.() ?? {})) {
        const original = up.getType(name).getFields()[field];
        expect(String(supported.type)).toBe(String(original.type));
        for (const arg of supported.args ?? [])
          expect(String(arg.type)).toBe(
            String(original.args.find((a) => a.name === arg.name).type),
          );
      }
    }
  },
);
caseWithDb('GraphQL scoped ids cannot read or assign objects from another workspace', async (f) => {
  const { id } = await import('../../packages/server/core/crypto.mjs');
  const other = id(),
    team = id();
  await f.db.transaction(async (tx) => {
    await tx.exec('INSERT INTO workspaces(id,name,slug,created_at) VALUES(?,?,?,?)', [
      other,
      'Private',
      'private',
      new Date().toISOString(),
    ]);
    await tx.exec('INSERT INTO teams(id,workspace_id,key,name,next_number) VALUES(?,?,?,?,?)', [
      team,
      other,
      'SEC',
      'Private team',
      1,
    ]);
  });
  expect(
    (await gql(f, 'query($id:String!){team(id:$id){id name}}', { id: team })).data.errors,
  ).toBeDefined();
  const r = await gql(f, 'mutation($i:IssueCreateInput!){issueCreate(input:$i){success}}', {
    i: { teamId: team, title: 'Cross-workspace' },
  });
  expect(r.data.errors).toBeDefined();
  expect((await gql(f, '{teams{nodes{id}}}')).data.data.teams.nodes).toEqual([
    { id: f.init.team_id },
  ]);
});
