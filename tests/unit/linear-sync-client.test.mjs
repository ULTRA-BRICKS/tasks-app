import { test, expect } from 'bun:test';
import {
  classifyLinearError,
  linearGraphQL,
  fetchIssue,
  fetchComment,
  fetchOrganizationId,
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
test('HTTP 200 with a generic errors[] array (application-level GraphQL error, e.g. FORBIDDEN) is blocked/retryable, NEVER not_found', () => {
  // A GraphQL error at HTTP 200 is not a verified "the entity is gone" signal from Linear —
  // it can be a permission problem, a validation error, or a partial response. Only an
  // explicit null single-entity field with NO errors present (see the test above) is a
  // legitimate deletion signal. Treating any errors[] as not_found would tombstone content
  // on a permission hiccup — this is exactly the bug the independent review flagged.
  const result = classifyLinearError({
    status: 200,
    headers: new Headers(),
    body: { errors: [{ message: 'Entity not found' }] },
  });
  expect(result.kind).not.toBe('not_found');
  expect(['blocked', 'retryable']).toContain(result.kind);
});
test('HTTP 200 with a FORBIDDEN GraphQL error classifies as unauthorized/blocked, never not_found (never tombstones)', () => {
  const result = classifyLinearError(
    {
      status: 200,
      headers: new Headers(),
      body: { data: { issue: null }, errors: [{ extensions: { code: 'FORBIDDEN' } }] },
    },
    { entityKey: 'issue' },
  );
  expect(result.kind).not.toBe('not_found');
  expect(['blocked', 'unauthorized']).toContain(result.kind);
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

// A.2: retryAfterMsFrom (retry-after header parsing) must accept BOTH the RFC 9110
// integer-seconds form AND an HTTP-date, since Linear (like most APIs) can send either.
test('Retry-After as an HTTP-date is parsed into a millisecond delay, not just integer seconds', () => {
  const future = new Date(Date.now() + 45000);
  const result = classifyLinearError({
    status: 429,
    headers: new Headers({ 'retry-after': future.toUTCString() }),
    body: null,
  });
  expect(result.kind).toBe('retryable');
  // Allow generous slack for the toUTCString() round-trip losing sub-second precision.
  expect(result.retryAfterMs).toBeGreaterThan(40000);
  expect(result.retryAfterMs).toBeLessThan(50000);
});
test('an unparseable Retry-After value falls back to null (existing default-backoff behavior)', () => {
  const result = classifyLinearError({
    status: 429,
    headers: new Headers({ 'retry-after': 'not-a-date-or-a-number' }),
    body: null,
  });
  expect(result).toEqual({ kind: 'retryable', retryAfterMs: null });
});

// A.2: fetchIssue/fetchComment/fetchOrganizationId must thread an optional `signal`
// through to linearGraphQL/fetcher, not silently drop it -- otherwise a caller with its
// own shared deadline (e.g. the worker's per-run budget) has no way to bound/cancel them.
test('fetchIssue forwards a caller-supplied signal to the fetcher, replacing the internal default', async () => {
  const controller = new AbortController();
  let seenSignal = null;
  await fetchIssue({ LINEAR_API_TOKEN: 'test-token' }, 'src-1', {
    signal: controller.signal,
    fetcher: async (url, options) => {
      seenSignal = options.signal;
      return new Response(JSON.stringify({ data: { issue: { id: 'src-1' } } }), { status: 200 });
    },
  });
  expect(seenSignal).toBe(controller.signal);
});
test('fetchComment forwards a caller-supplied signal to the fetcher', async () => {
  const controller = new AbortController();
  let seenSignal = null;
  await fetchComment({ LINEAR_API_TOKEN: 'test-token' }, 'src-1', {
    signal: controller.signal,
    fetcher: async (url, options) => {
      seenSignal = options.signal;
      return new Response(JSON.stringify({ data: { comment: { id: 'src-1' } } }), { status: 200 });
    },
  });
  expect(seenSignal).toBe(controller.signal);
});
test('fetchOrganizationId forwards a caller-supplied signal to the fetcher', async () => {
  const controller = new AbortController();
  let seenSignal = null;
  await fetchOrganizationId(
    { LINEAR_API_TOKEN: 'test-token' },
    {
      signal: controller.signal,
      fetcher: async (url, options) => {
        seenSignal = options.signal;
        return new Response(JSON.stringify({ data: { organization: { id: 'org-1' } } }), {
          status: 200,
        });
      },
    },
  );
  expect(seenSignal).toBe(controller.signal);
});
test('without a caller-supplied signal, the internal default (AbortSignal.timeout) is still used', async () => {
  let seenSignal = null;
  await fetchIssue({ LINEAR_API_TOKEN: 'test-token' }, 'src-1', {
    fetcher: async (url, options) => {
      seenSignal = options.signal;
      return new Response(JSON.stringify({ data: { issue: { id: 'src-1' } } }), { status: 200 });
    },
  });
  expect(seenSignal).toBeInstanceOf(AbortSignal);
});
