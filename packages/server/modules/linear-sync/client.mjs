// Outbound, read-only Linear GraphQL client used by the ongoing sync worker/reconciler.
// Never called from webhook receipt (that path only verifies and persists). Every network
// call takes an injected `fetcher` so tests never touch a real socket.
import { assert } from '../../core/errors.mjs';

export const LINEAR_GRAPHQL_ENDPOINT = 'https://api.linear.app/graphql';

export async function linearGraphQL(env, query, variables, { fetcher = fetch, signal } = {}) {
  assert(
    env.LINEAR_API_TOKEN,
    503,
    'LINEAR_SYNC_NOT_CONFIGURED',
    'Linear API token is not configured',
  );
  const response = await fetcher(LINEAR_GRAPHQL_ENDPOINT, {
    method: 'POST',
    redirect: 'manual',
    signal: signal ?? AbortSignal.timeout(15000),
    headers: {
      authorization: env.LINEAR_API_TOKEN,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  // A redirect could silently retarget the request to an attacker-controlled host.
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400))
    throw new Error('Linear API returned an unexpected redirect');
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, headers: response.headers, body };
}

function retryAfterMsFrom(headers) {
  const raw = headers?.get ? headers.get('retry-after') : (headers?.['retry-after'] ?? null);
  return raw && /^\d+$/.test(String(raw)) ? Number(raw) * 1000 : null;
}
function hasErrorCode(body, code) {
  return Array.isArray(body?.errors) && body.errors.some((e) => e?.extensions?.code === code);
}

// Pure and network-free on purpose: unit-tested directly against constructed fixture
// responses. The not-found-vs-unauthorized split and the HTTP-400-RATELIMITED case are
// documented assumptions (see docs/LINEAR-SYNC.md) — not live-verified against a real
// Linear delivery.
export function classifyLinearError(
  { status, headers, body } = {},
  { entityKey, expectedOrganizationId } = {},
) {
  const retryAfterMs = retryAfterMsFrom(headers);
  if (status === 429 || (status >= 500 && status <= 599))
    return { kind: 'retryable', retryAfterMs };
  if (status === 400 && hasErrorCode(body, 'RATELIMITED'))
    return { kind: 'retryable', retryAfterMs };
  // Linear never returns 401/403 for a deletion; treat both as a permission problem only.
  if (status === 401 || status === 403) return { kind: 'unauthorized' };
  if (status !== 200) return { kind: 'retryable', retryAfterMs };
  if (
    expectedOrganizationId &&
    body?.data?.organization &&
    body.data.organization.id !== expectedOrganizationId
  )
    return { kind: 'org_mismatch' };
  if (
    entityKey &&
    body?.data &&
    Object.hasOwn(body.data, entityKey) &&
    body.data[entityKey] === null
  )
    return { kind: 'not_found' };
  if (Array.isArray(body?.errors) && body.errors.length) return { kind: 'not_found' };
  return { kind: 'ok', data: body?.data };
}

export async function fetchOrganizationId(env, { fetcher } = {}) {
  const result = await linearGraphQL(env, '{ organization { id } }', {}, { fetcher });
  return { result, classification: classifyLinearError(result) };
}

export async function fetchIssue(env, sourceId, { fetcher } = {}) {
  const query = `query($id: String!) { issue(id: $id) {
    id identifier number title description url priority estimate dueDate sortOrder trashed archivedAt createdAt updatedAt
    team { id } state { id } assignee { id } creator { id } project { id } cycle { id } projectMilestone { id } parent { id }
    labelIds
  } }`;
  const result = await linearGraphQL(env, query, { id: sourceId }, { fetcher });
  return { result, classification: classifyLinearError(result, { entityKey: 'issue' }) };
}

export async function fetchComment(env, sourceId, { fetcher } = {}) {
  const query = `query($id: String!) { comment(id: $id) {
    id issue { id } user { id } body createdAt updatedAt
  } }`;
  const result = await linearGraphQL(env, query, { id: sourceId }, { fetcher });
  return { result, classification: classifyLinearError(result, { entityKey: 'comment' }) };
}
