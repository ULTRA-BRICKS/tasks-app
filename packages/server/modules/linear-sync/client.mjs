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

// Retry-After (RFC 9110 §10.2.3) is EITHER an integer number of seconds OR an HTTP-date.
// Linear, like most APIs, can send either form — parse both, fall back to null (the
// existing "no retry hint, use default backoff" behavior) only if neither parses.
function retryAfterMsFrom(headers) {
  const raw = headers?.get ? headers.get('retry-after') : (headers?.['retry-after'] ?? null);
  if (!raw) return null;
  const text = String(raw);
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}
function hasErrorCode(body, code) {
  return Array.isArray(body?.errors) && body.errors.some((e) => e?.extensions?.code === code);
}

const AUTH_ERROR_CODES = new Set(['FORBIDDEN', 'UNAUTHENTICATED', 'ACCESS_DENIED']);

// Pure and network-free on purpose: unit-tested directly against constructed fixture
// responses. The not-found-vs-blocked split and the HTTP-400-RATELIMITED case are
// documented assumptions (see docs/LINEAR-SYNC.md) — not live-verified against a real
// Linear delivery.
//
// `not_found` is reserved for an EXPLICIT, verified removal signal: HTTP 200, the
// requested entity field present and null, and NO errors[] on the response at all. ANY
// errors[] present — even alongside a null entity field — is `unauthorized` (an
// auth-coded error) or `blocked` (anything else). This is deliberate: a GraphQL error at
// HTTP 200 is not a verified "the entity is gone" signal — it can be a permission
// problem, a validation error, or a partial response — and treating it as not_found would
// tombstone content on a permission hiccup instead of leaving it untouched and retryable.
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
  if (expectedOrganizationId) {
    // A 200 response with no `organization` field at all is NOT a validated organization
    // — never treat a missing field as an implicit match.
    if (!body?.data?.organization) return { kind: 'blocked' };
    if (body.data.organization.id !== expectedOrganizationId) return { kind: 'org_mismatch' };
  }
  if (Array.isArray(body?.errors) && body.errors.length) {
    const authError = body.errors.some((e) => AUTH_ERROR_CODES.has(e?.extensions?.code));
    return { kind: authError ? 'unauthorized' : 'blocked' };
  }
  if (
    entityKey &&
    body?.data &&
    Object.hasOwn(body.data, entityKey) &&
    body.data[entityKey] === null
  )
    return { kind: 'not_found' };
  return { kind: 'ok', data: body?.data };
}

export async function fetchOrganizationId(env, { fetcher, signal } = {}) {
  const result = await linearGraphQL(env, '{ organization { id } }', {}, { fetcher, signal });
  return { result, classification: classifyLinearError(result) };
}

export async function fetchIssue(env, sourceId, { fetcher, signal } = {}) {
  const query = `query($id: String!) { issue(id: $id) {
    id identifier number title description url priority estimate dueDate sortOrder trashed archivedAt createdAt updatedAt
    team { id } state { id } assignee { id } creator { id } project { id } cycle { id } projectMilestone { id } parent { id }
    labelIds
  } }`;
  const result = await linearGraphQL(env, query, { id: sourceId }, { fetcher, signal });
  return { result, classification: classifyLinearError(result, { entityKey: 'issue' }) };
}

export async function fetchComment(env, sourceId, { fetcher, signal } = {}) {
  const query = `query($id: String!) { comment(id: $id) {
    id issue { id } user { id } body createdAt updatedAt
  } }`;
  const result = await linearGraphQL(env, query, { id: sourceId }, { fetcher, signal });
  return { result, classification: classifyLinearError(result, { entityKey: 'comment' }) };
}
