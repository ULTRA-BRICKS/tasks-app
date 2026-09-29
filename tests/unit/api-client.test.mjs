import { test, expect } from 'bun:test';
import assert from 'node:assert/strict';
import { api, ApiError, setApiSession } from '../../src/shared/api/client.ts';
async function withFetch(response, run) {
  const original = globalThis.fetch;
  globalThis.fetch = response;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}
test('API diagnostics show path/status but never response body or query secrets', async () => {
  await withFetch(
    async () =>
      new Response('<html>private backend error</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    async () => {
      try {
        await api('/v1/issues?token=private-token');
        throw new Error('Expected rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        const e = error;
        expect(e.status).toBe(502);
        expect(e.code).toBe('INVALID_RESPONSE');
        expect(e.message).toContain('/api/v1/issues');
        expect(e.message).toContain('HTML');
        expect(e.message).not.toContain('private-token');
        expect(e.message).not.toContain('private backend error');
      }
    },
  );
});
test('request headers survive the wrapper and JSON success is returned', async () => {
  await withFetch(
    async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('idempotency-key')).toBe('test-key');
      expect(headers.get('x-tickets-csrf')).toBe('1');
      expect(headers.get('content-type')).toBe('application/json');
      expect(init?.credentials).toBe('same-origin');
      return Response.json({ id: 'ok' });
    },
    async () => {
      expect(
        await api('/v1/issues', {
          method: 'POST',
          headers: new Headers({ 'idempotency-key': 'test-key' }),
          json: { title: 'Test' },
        }),
      ).toEqual({ id: 'ok' });
    },
  );
});
test('network errors are actionable and aborts keep cancellation semantics', async () => {
  await withFetch(
    async () => {
      throw new Error('secret transport detail');
    },
    async () => {
      await assert.rejects(() => api('/v1/issues'), {
        status: 0,
        code: 'NETWORK_UNAVAILABLE',
      });
    },
  );
  await withFetch(
    async () => {
      throw new DOMException('Canceled', 'AbortError');
    },
    async () => {
      await assert.rejects(() => api('/v1/issues'), { name: 'AbortError' });
    },
  );
});
test('a saved read-only copy blocks writes before the network while sign-in routes stay available', async () => {
  let calls = 0;
  const unauthorized = [];
  setApiSession({ canWrite: () => false, onUnauthorized: (path) => unauthorized.push(path) });
  try {
    await withFetch(
      async () => {
        calls++;
        return Response.json({ ok: true });
      },
      async () => {
        await assert.rejects(() => api('/v1/issues/1', { method: 'PATCH', json: {} }), {
          code: 'READ_ONLY_SAVED_COPY',
        });
        expect(calls).toBe(0);
        expect(await api('/v1/issues')).toEqual({ ok: true });
        expect(await api('/auth/logout', { method: 'POST' })).toEqual({ ok: true });
        expect(calls).toBe(2);
      },
    );
    await withFetch(
      async () =>
        Response.json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }, { status: 401 }),
      async () => {
        await assert.rejects(() => api('/v1/issues'), { status: 401 });
        await assert.rejects(() => api('/auth/login', { method: 'POST', json: {} }), {
          status: 401,
        });
      },
    );
    // A wrong password on the sign-in route is not a revoked session.
    expect(unauthorized).toEqual(['/v1/issues']);
  } finally {
    setApiSession(null);
  }
});
test('rate-limit replies expose Retry-After seconds and dates as a bounded delay', async () => {
  for (const [header, expected] of [
    ['30', 30_000],
    ['99999', 3_600_000],
    [new Date(Date.now() + 90_000).toUTCString(), 90_000],
    ['soon', undefined],
  ]) {
    await withFetch(
      async () =>
        Response.json(
          { error: { code: 'RATE_LIMITED', message: 'Slow down' } },
          { status: 429, headers: { 'retry-after': header } },
        ),
      async () => {
        const error = await api('/v1/me').catch((e) => e);
        expect(error.status).toBe(429);
        if (expected === undefined) expect(error.retryAfterMs).toBeUndefined();
        else expect(Math.abs(error.retryAfterMs - expected)).toBeLessThan(2_000);
      },
    );
  }
});
