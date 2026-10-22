// Read-only export of a Linear workspace into the `tickets-linear-snapshot-v1` directory that
// `loadSnapshot` (packages/imports/linear-source.mjs) verifies. Only GraphQL queries are issued.
// Usage: LINEAR_API_KEY=... bun scripts/export-linear-snapshot.mjs --out EMPTY_PRIVATE_DIRECTORY
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { collections, uuid } from '../packages/imports/linear-source.mjs';

const { values } = parseArgs({ strict: true, options: { out: { type: 'string' } } });
if (!values.out) throw new Error('Use --out EMPTY_PRIVATE_DIRECTORY');
const token = process.env.LINEAR_API_KEY;
if (!token || /\s/.test(token)) throw new Error('Provide LINEAR_API_KEY in the environment');
const out = resolve(values.out);
await mkdir(out, { recursive: true, mode: 0o700 });
if ((await readdir(out)).length) throw new Error('Output directory must be empty');

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let requests = 0;
async function gql(query, variables = {}) {
  for (let attempt = 0; attempt < 8; attempt++) {
    requests++;
    let response;
    try {
      response = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {}
    const limited =
      response.status === 429 || body?.errors?.some((e) => e.extensions?.code === 'RATELIMITED');
    if (limited) {
      const reset = Number(response.headers.get('x-ratelimit-requests-reset'));
      const wait =
        Number.isFinite(reset) && reset * 1000 > Date.now()
          ? Math.min(reset * 1000 - Date.now(), 3600000)
          : 60000;
      console.error('rate limited; waiting', Math.ceil(wait / 1000), 's');
      await sleep(wait + 1000);
      continue;
    }
    if (response.status >= 500) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!response.ok || body?.errors?.length || !body?.data)
      throw new Error(
        'Linear query rejected: ' +
          response.status +
          ' ' +
          JSON.stringify(body?.errors?.map((e) => e.message) ?? text.slice(0, 200)),
      );
    return body.data;
  }
  throw new Error('Linear request failed after retries');
}
async function all(field, selection, { first = 100, args = '' } = {}) {
  const rows = [];
  let after = null;
  for (;;) {
    const data = await gql(
      `query($after:String){${field}(first:${first},after:$after,includeArchived:true${args}){nodes{${selection}}pageInfo{hasNextPage endCursor}}}`,
      { after },
    );
    const page = data[field];
    rows.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return rows;
    after = page.pageInfo.endCursor;
  }
}
const dates = 'id createdAt updatedAt archivedAt';
const selections = {
  teams: dates + ' key name',
  users: dates + ' name displayName email avatarUrl active',
  workflowStates: dates + ' name type color position team{id}',
  issueLabels: dates + ' name color team{id} parent{id}',
  projectStatuses: dates + ' name type color position',
  projects:
    dates +
    ' name description content health startDate targetDate url status{id type} lead{id} teams(first:100){nodes{id}pageInfo{hasNextPage endCursor}}',
  projectMilestones: dates + ' name description targetDate sortOrder project{id}',
  cycles: dates + ' name number description startsAt endsAt team{id}',
  initiatives:
    dates +
    ' name description content status targetDate owner{id} url projects(first:100){nodes{id}pageInfo{hasNextPage endCursor}}',
  documents: dates + ' title content project{id} initiative{id} creator{id} url',
  attachments: dates + ' title subtitle url metadata issue{id}',
  issueRelations: dates + ' type issue{id} relatedIssue{id}',
  projectRelations: 'id createdAt updatedAt',
  initiativeRelations: 'id createdAt updatedAt',
  projectUpdates: dates + ' body url project{id} user{id}',
  initiativeUpdates: dates + ' body url initiative{id} user{id}',
};
const historyFields =
  'id createdAt updatedAt actorId archived autoArchived autoClosed trashed updatedDescription ' +
  'addedLabelIds removedLabelIds attachmentId changes relationChanges{identifier type} ' +
  'fromAssigneeId toAssigneeId fromCycleId toCycleId fromDueDate toDueDate fromEstimate toEstimate ' +
  'fromParentId toParentId fromPriority toPriority fromProjectId toProjectId fromStateId toStateId ' +
  'fromTeamId toTeamId fromTitle toTitle';
const data = Object.fromEntries(collections.map((c) => [c, []]));
const pageSize = { projects: 10, initiatives: 10, documents: 25 };
const lazy = new Set(['comments', 'issues', 'issueHistory', 'teamMembers']);
for (const name of collections) {
  if (lazy.has(name)) continue;
  data[name] = await all(name, selections[name], { first: pageSize[name] ?? 100 });
  console.error(name, data[name].length);
}
data.issues = await all(
  'issues',
  dates +
    ' identifier number title description priority estimate dueDate sortOrder trashed url startedAt completedAt canceledAt team{id} state{id} assignee{id} creator{id} project{id} projectMilestone{id} cycle{id} parent{id} labelIds',
  { first: 50 },
);
console.error('issues', data.issues.length);
const rawComments = await all('comments', dates + ' body issue{id} user{id name email} parent{id}');
const exclusions = { nonIssueComments: [] };
for (const { issue, ...comment } of rawComments) {
  if (issue?.id) data.comments.push({ ...comment, issueId: issue.id });
  else exclusions.nonIssueComments.push(comment.id);
}
console.error(
  'comments',
  data.comments.length,
  'non-issue excluded',
  exclusions.nonIssueComments.length,
);
data.teamMembers = await all(
  'teamMemberships',
  'id createdAt updatedAt archivedAt owner user{id} team{id}',
);
console.error('teamMembers', data.teamMembers.length);
// History per issue, ten issues per request with a bounded first page; longer histories are completed individually.
const history = new Map();
const ids = data.issues.map((issue) => issue.id);
for (let i = 0; i < ids.length; i += 10) {
  const batch = ids.slice(i, i + 10);
  const result = await gql(
    `query{${batch.map((id, n) => `i${n}:issue(id:"${id}"){id history(first:20){nodes{${historyFields}}pageInfo{hasNextPage endCursor}}}`).join(' ')}}`,
  );
  for (const [n, id] of batch.entries()) {
    const record = result['i' + n];
    if (!record || record.id !== id) throw new Error('History source mismatch');
    const nodes = [...record.history.nodes];
    let page = record.history.pageInfo;
    while (page.hasNextPage) {
      const more = await gql(
        `query($id:String!,$after:String){issue(id:$id){id history(first:50,after:$after){nodes{${historyFields}}pageInfo{hasNextPage endCursor}}}}`,
        { id, after: page.endCursor },
      );
      nodes.push(...more.issue.history.nodes);
      page = more.issue.history.pageInfo;
    }
    history.set(id, nodes);
  }
}
data.issueHistory = ids.map((id) => ({ id, history: { nodes: history.get(id) } }));
console.error(
  'issueHistory events',
  [...history.values()].reduce((n, a) => n + a.length, 0),
);

// People referenced by records but absent from the user list (guests/removed) are fetched individually.
const known = new Set(data.users.map((user) => user.id));
const wanted = new Set();
const note = (value) => {
  const id = typeof value === 'string' ? value : value?.id;
  if (id && !known.has(id)) wanted.add(id);
};
for (const issue of data.issues) [issue.creator, issue.assignee].forEach(note);
for (const comment of data.comments) note(comment.user);
for (const project of data.projects) note(project.lead);
for (const initiative of data.initiatives) note(initiative.owner);
for (const document of data.documents) note(document.creator);
for (const update of [...data.projectUpdates, ...data.initiativeUpdates]) note(update.user);
for (const member of data.teamMembers) note(member.user);
for (const record of data.issueHistory)
  for (const event of record.history.nodes) {
    note(event.actorId);
    note(event.fromAssigneeId);
    note(event.toAssigneeId);
  }
exclusions.fetchedUnlistedUsers = [];
exclusions.unavailableUsers = [];
for (const id of wanted) {
  const fetched = (await gql(`query($id:String!){user(id:$id){${selections.users}}}`, { id }).catch(() => null))?.user;
  if (fetched?.id === id) {
    data.users.push(fetched);
    exclusions.fetchedUnlistedUsers.push(id);
  } else exclusions.unavailableUsers.push(id);
}

// Records of a team Linear no longer lists (deleted team) cannot be resolved; keep them out only if unreferenced.
const teamIds = new Set(data.teams.map((team) => team.id));
exclusions.orphanTeamRecords = {};
for (const name of ['workflowStates', 'issueLabels', 'teamMembers']) {
  const orphaned = data[name].filter((row) => row.team?.id && !teamIds.has(row.team.id));
  exclusions.orphanTeamRecords[name] = orphaned.map((row) => row.id);
  const gone = new Set(orphaned.map((row) => row.id));
  if (name === 'workflowStates' && data.issues.some((issue) => gone.has(issue.state?.id)))
    throw new Error('An issue uses a workflow state of an unlisted team');
  if (name === 'issueLabels' && data.issues.some((issue) => issue.labelIds?.some((id) => gone.has(id))))
    throw new Error('An issue uses a label of an unlisted team');
  data[name] = data[name].filter((row) => !gone.has(row.id));
}

// Connection pages nested in a record must be complete (loadSnapshot enforces it too).
for (const name of ['projects', 'initiatives'])
  for (const row of data[name])
    for (const [key, value] of Object.entries(row))
      if (value?.pageInfo) {
        if (value.pageInfo.hasNextPage) throw new Error('Unfinished nested pagination: ' + name);
        row[key] = { nodes: value.nodes };
      }

// Second pass: the issue population and update times must not have moved during the export.
const second = await all('issues', 'id updatedAt', { first: 100 });
const before = new Map(data.issues.map((x) => [x.id, x.updatedAt]));
const after = new Map(second.map((x) => [x.id, x.updatedAt]));
const drift = {
  added: [...after.keys()].filter((id) => !before.has(id)),
  removed: [...before.keys()].filter((id) => !after.has(id)),
  changed: [...before]
    .filter(([id, at]) => after.has(id) && after.get(id) !== at)
    .map(([id]) => id),
};

const findings = [];
for (const name of collections) {
  if (!Array.isArray(data[name])) findings.push('missing ' + name);
  for (const row of data[name]) if (!uuid(row.id)) findings.push('non-UUID id in ' + name);
}
const organization = (await gql('{organization{id name urlKey}}')).organization;
const sha256 = {};
const counts = {};
for (const name of collections) {
  const bytes = Buffer.from(JSON.stringify(data[name]), 'utf8');
  await writeFile(resolve(out, name + '.json'), bytes, { mode: 0o600 });
  sha256[name + '.json'] = createHash('sha256').update(bytes).digest('hex');
  counts[name] = data[name].length;
}
const manifest = {
  format: 'tickets-linear-snapshot-v1',
  organization,
  exportedAt: new Date().toISOString(),
  readOnly: true,
  requests,
  counts,
  sha256,
  exclusions,
  validationFindings: findings,
  issueVerificationDrift: drift,
};
await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
  mode: 0o600,
});
console.log(
  JSON.stringify({
    counts,
    drift,
    findings,
    requests,
    exclusions: { nonIssueComments: exclusions.nonIssueComments.length },
  }),
);
if (findings.length || Object.values(drift).some((list) => list.length)) process.exitCode = 1;
