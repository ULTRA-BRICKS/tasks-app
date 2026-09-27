import { AppError, assert } from '../../core/errors.mjs';
import { uuid } from '../../../imports/linear-source.mjs';
const model = (one, many, fields, connections = []) => ({ one, many, fields, connections });
const dates = 'id createdAt updatedAt archivedAt';
export const SOURCE_MODELS = Object.freeze({
  issues: model(
    'issue',
    'issues',
    dates +
      ' identifier number title description priority estimate dueDate sortOrder trashed url team{id} state{id} assignee{id} creator{id} project{id} projectMilestone{id} cycle{id} parent{id} labelIds',
  ),
  comments: model('comment', 'comments', dates + ' body issue{id} user{id name email} parent{id}'),
  teams: model('team', 'teams', dates + ' key name'),
  workflowStates: model(
    'workflowState',
    'workflowStates',
    dates + ' name type color position team{id}',
  ),
  issueLabels: model('issueLabel', 'issueLabels', dates + ' name color team{id} parent{id}'),
  users: model('user', 'users', dates + ' name displayName email avatarUrl active'),
  projects: model(
    'project',
    'projects',
    dates +
      ' name description content health startDate targetDate url status{id type} lead{id} teams(first:100){nodes{id}pageInfo{hasNextPage endCursor}}',
    ['teams'],
  ),
  projectMilestones: model(
    'projectMilestone',
    'projectMilestones',
    dates + ' name description targetDate sortOrder project{id}',
  ),
  cycles: model('cycle', 'cycles', dates + ' name number description startsAt endsAt team{id}'),
  documents: model(
    'document',
    'documents',
    dates + ' title content project{id} initiative{id} creator{id} url',
  ),
  initiatives: model(
    'initiative',
    'initiatives',
    dates +
      ' name description content status targetDate owner{id} url projects(first:100){nodes{id}pageInfo{hasNextPage endCursor}}',
    ['projects'],
  ),
  issueRelations: model(
    'issueRelation',
    'issueRelations',
    dates + ' type issue{id} relatedIssue{id}',
  ),
  attachments: model('attachment', 'attachments', dates + ' title url metadata issue{id}'),
  projectUpdates: model(
    'projectUpdate',
    'projectUpdates',
    dates + ' body url project{id} user{id}',
  ),
  initiativeUpdates: model(
    'initiativeUpdate',
    'initiativeUpdates',
    dates + ' body url initiative{id} user{id}',
  ),
});
export class SourceError extends Error {
  constructor(code, retryAfterSeconds = 15) {
    super(code);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
export async function requestLinear(env, query, variables = {}, options = {}) {
  assert(
    typeof env.LINEAR_API_TOKEN === 'string' && env.LINEAR_API_TOKEN.length > 0,
    503,
    'SYNC_NOT_CONFIGURED',
    'Source credential is absent',
  );
  const remaining = (options.deadline ?? Date.now() + 12000) - Date.now();
  if (remaining < 250) throw new SourceError('SYNC_TIME_BUDGET', 1);
  const signal = AbortSignal.any([
    AbortSignal.timeout(Math.max(1, Math.min(12000, remaining))),
    ...(options.signal ? [options.signal] : []),
  ]);
  const response = await (options.fetcher ?? fetch)('https://api.linear.app/graphql', {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: env.LINEAR_API_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal,
  });
  const retry = response.headers.get('retry-after');
  const retrySeconds = retry
    ? /^\d+$/.test(retry)
      ? Number(retry)
      : Math.max(1, Math.ceil((Date.parse(retry) - Date.now()) / 1000))
    : 30;
  if (response.status === 429) throw new SourceError('SOURCE_RATE_LIMITED', retrySeconds);
  assert(
    response.status !== 401 && response.status !== 403,
    403,
    'SOURCE_ACCESS_DENIED',
    'Source permission is unavailable',
  );
  if (response.status >= 500) throw new SourceError('SOURCE_UNAVAILABLE');
  const text = await response.text();
  assert(
    text.length <= 3000000,
    413,
    'SOURCE_RESPONSE_TOO_LARGE',
    'Source response exceeds the processing budget',
  );
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new SourceError('SOURCE_INVALID_RESPONSE');
  }
  if (result.errors?.length) {
    const codes = result.errors.map(
      (e) => e.extensions?.code ?? e.extensions?.userPresentableMessage,
    );
    if (codes.includes('RATELIMITED')) throw new SourceError('SOURCE_RATE_LIMITED', retrySeconds);
    if (codes.some((c) => ['FORBIDDEN', 'AUTHENTICATION_ERROR', 'UNAUTHENTICATED'].includes(c)))
      throw new AppError(403, 'SOURCE_ACCESS_DENIED', 'Source permission is unavailable');
    throw new AppError(422, 'SOURCE_QUERY_REJECTED', 'The source rejected this operation');
  }
  assert(
    response.ok && result.data && typeof result.data === 'object',
    502,
    'SOURCE_INVALID_RESPONSE',
    'Source response was not confirmed',
  );
  return result.data;
}
function checkRecord(record, id) {
  if (record === null) return null;
  assert(
    record && record.id === id && uuid(record.id),
    422,
    'SOURCE_ID_MISMATCH',
    'Source response does not match the requested UUID',
  );
  assert(
    typeof record.updatedAt === 'string' && Number.isFinite(Date.parse(record.updatedAt)),
    422,
    'SOURCE_INVALID_TIME',
    'Source update timestamp is absent',
  );
  return record;
}
export async function readSourceEntity(env, collection, id, options = {}) {
  const definition = SOURCE_MODELS[collection];
  assert(definition && uuid(id), 422, 'SOURCE_MODEL_UNSUPPORTED', 'Invalid source entity request');
  const query = `query SyncEntity($id:String!){${definition.one}(id:$id){${definition.fields}}}`;
  const data = await requestLinear(env, query, { id }, options),
    record = checkRecord(data[definition.one], id);
  if (!record) return null;
  for (const connection of definition.connections) {
    const original = record[connection];
    assert(
      original &&
        Array.isArray(original.nodes) &&
        typeof original.pageInfo?.hasNextPage === 'boolean',
      422,
      'SOURCE_INCOMPLETE_CONNECTION',
      'Source connection is incomplete',
    );
    let page = original,
      seen = new Set();
    while (page.pageInfo.hasNextPage) {
      const cursor = page.pageInfo.endCursor;
      assert(
        typeof cursor === 'string' && !seen.has(cursor) && seen.size < 20,
        422,
        'SOURCE_INVALID_CURSOR',
        'Source connection could not be completed',
      );
      seen.add(cursor);
      const result = await requestLinear(
        env,
        `query SyncConnection($id:String!,$after:String){${definition.one}(id:$id){id updatedAt ${connection}(first:100,after:$after){nodes{id}pageInfo{hasNextPage endCursor}}}}`,
        { id, after: cursor },
        options,
      );
      const next = checkRecord(result[definition.one], id);
      if (!next || next.updatedAt !== record.updatedAt)
        throw new SourceError('SOURCE_CHANGED_DURING_READ', 2);
      page = next[connection];
      assert(
        page && Array.isArray(page.nodes) && typeof page.pageInfo?.hasNextPage === 'boolean',
        422,
        'SOURCE_INVALID_CURSOR',
        'Invalid connection page',
      );
      original.nodes.push(...page.nodes);
    }
    assert(
      new Set(original.nodes.map((n) => n.id)).size === original.nodes.length,
      422,
      'SOURCE_DUPLICATE_PAGE',
      'Connection repeated a record',
    );
    original.pageInfo = { hasNextPage: false, endCursor: page.pageInfo.endCursor };
  }
  return record;
}
export async function readSourcePage(
  env,
  collection,
  { cursor = null, limit = 100, since = null, until = null } = {},
  options = {},
) {
  const definition = SOURCE_MODELS[collection];
  assert(
    definition && Number.isInteger(limit) && limit >= 1 && limit <= 100,
    422,
    'SOURCE_MODEL_UNSUPPORTED',
    'Invalid source page request',
  );
  let filter = '';
  if (since || until) {
    for (const time of [since, until].filter(Boolean))
      assert(
        typeof time === 'string' &&
          /^\d{4}-\d{2}-\d{2}T/.test(time) &&
          Number.isFinite(Date.parse(time)),
        422,
        'INVALID_SCAN_TIME',
        'Invalid scan boundary',
      );
    filter =
      ',filter:{updatedAt:{' +
      [since ? 'gte:' + JSON.stringify(since) : '', until ? 'lte:' + JSON.stringify(until) : '']
        .filter(Boolean)
        .join(',') +
      '}}';
  }
  const query = `query SyncPage($after:String){${definition.many}(first:${limit},after:$after,includeArchived:true${filter}){nodes{id updatedAt}pageInfo{hasNextPage endCursor}}}`;
  const result = (await requestLinear(env, query, { after: cursor }, options))[definition.many];
  assert(
    result && Array.isArray(result.nodes) && typeof result.pageInfo?.hasNextPage === 'boolean',
    422,
    'SOURCE_INVALID_PAGE',
    'Source page is incomplete',
  );
  assert(
    !result.pageInfo.hasNextPage ||
      (typeof result.pageInfo.endCursor === 'string' && result.pageInfo.endCursor !== cursor),
    422,
    'SOURCE_INVALID_CURSOR',
    'Source pagination did not advance',
  );
  for (const node of result.nodes) checkRecord(node, node?.id);
  return result;
}
export async function verifySourceOrganization(env, expected, options = {}) {
  const data = await requestLinear(
    env,
    'query SyncOrganization { organization { id } }',
    {},
    options,
  );
  assert(
    data.organization?.id === expected,
    403,
    'SOURCE_ORGANIZATION_MISMATCH',
    'Source credential belongs to a different organization',
  );
}
