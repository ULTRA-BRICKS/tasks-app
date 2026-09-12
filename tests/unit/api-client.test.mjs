import { test, expect } from 'bun:test';
import assert from 'node:assert/strict';
import { api, ApiError } from '../../src/shared/api/client.ts';
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
