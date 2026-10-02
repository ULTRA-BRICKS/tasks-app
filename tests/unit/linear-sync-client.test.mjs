import { test, expect } from 'bun:test';
import {
  classifyLinearError,
  linearGraphQL,
} from '../../packages/server/modules/linear-sync/client.mjs';

test('HTTP 429 with Retry-After classifies as retryable with the header delay', () => {
  const result = classifyLinearError({
    status: 429,
    headers: new Headers({ 'retry-after': '30' }),
    body: null,
  });
  expect(result).toEqual({ kind: 'retryable', retryAfterMs: 30000 });
});
test('HTTP 400 with a RATELIMITED GraphQL error code is retryable, not treated as a hard failure', () => {
  const result = classifyLinearError({
    status: 400,
    headers: new Headers(),
    body: { errors: [{ message: 'Rate limited', extensions: { code: 'RATELIMITED' } }] },
  });
  expect(result.kind).toBe('retryable');
});
test('HTTP 5xx classifies as retryable', () => {
  expect(classifyLinearError({ status: 503, headers: new Headers(), body: null }).kind).toBe(
    'retryable',
  );
});
test('HTTP 401/403 classify as unauthorized, distinct from not_found', () => {
  expect(classifyLinearError({ status: 401, headers: new Headers(), body: null }).kind).toBe(
    'unauthorized',
  );
  expect(classifyLinearError({ status: 403, headers: new Headers(), body: null }).kind).toBe(
    'unauthorized',
  );
});
test('a null single-entity query result is not_found, not unauthorized', () => {
  const result = classifyLinearError(
    { status: 200, headers: new Headers(), body: { data: { issue: null } } },
    { entityKey: 'issue' },
  );
  expect(result.kind).toBe('not_found');
});
test('HTTP 200 with a generic errors[] array (Linear not-found shape) is not_found', () => {
  const result = classifyLinearError({
    status: 200,
    headers: new Headers(),
    body: { errors: [{ message: 'Entity not found' }] },
  });
  expect(result.kind).toBe('not_found');
});
test('a matching organization id and present data classify as ok', () => {
  const result = classifyLinearError(
    { status: 200, headers: new Headers(), body: { data: { organization: { id: 'org-1' } } } },
    { expectedOrganizationId: 'org-1' },
  );
  expect(result).toEqual({ kind: 'ok', data: { organization: { id: 'org-1' } } });
});
test('a mismatched organization id classifies as org_mismatch', () => {
  const result = classifyLinearError(
    { status: 200, headers: new Headers(), body: { data: { organization: { id: 'org-2' } } } },
    { expectedOrganizationId: 'org-1' },
  );
  expect(result.kind).toBe('org_mismatch');
});
test('linearGraphQL refuses to configure without a token and never touches the network', async () => {
  let called = false;
  let error = null;
  try {
    await linearGraphQL(
      {},
      '{ organization { id } }',
      {},
      { fetcher: () => ((called = true), null) },
    );
  } catch (e) {
    error = e;
  }
  expect(error?.code).toBe('LINEAR_SYNC_NOT_CONFIGURED');
  expect(called).toBe(false);
});
test('linearGraphQL posts to the fixed endpoint with an injected fetcher, never a real network call', async () => {
  const calls = [];
  const result = await linearGraphQL(
    { LINEAR_API_TOKEN: 'test-token' },
    '{ organization { id } }',
    { a: 1 },
    {
      fetcher: async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify({ data: { organization: { id: 'org-1' } } }), {
          status: 200,
        });
      },
    },
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe('https://api.linear.app/graphql');
  expect(calls[0].options.headers.authorization).toBe('test-token');
  expect(JSON.parse(calls[0].options.body)).toEqual({
    query: '{ organization { id } }',
    variables: { a: 1 },
  });
  expect(result.body.data.organization.id).toBe('org-1');
});
