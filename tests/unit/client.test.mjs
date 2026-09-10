import { test, expect } from 'bun:test';
import { api, ApiError } from '../../src/shared/api/client.ts';
import { snapshotDraft, isDraftDirty } from '../../src/widgets/issue-details/model.ts';
test('client accepts Headers and tuple headers without dropping authorization or CSRF', async () => {
  const fetch = globalThis.fetch;
  try {
    for (const headers of [
      new Headers({ authorization: 'example-test-token' }),
      [['authorization', 'example-test-token']],
    ]) {
      let sent;
      globalThis.fetch = async (_url, init) => {
        sent = init;
        return Response.json({ ok: true });
      };
      expect(await api('/v1/issues', { method: 'POST', headers, json: { title: 'test' } })).toEqual(
        { ok: true },
      );
      expect(sent.headers.get('authorization')).toBe('example-test-token');
      expect(sent.headers.get('content-type')).toBe('application/json');
      expect(sent.headers.get('x-tickets-csrf')).toBe('1');
    }
  } finally {
    globalThis.fetch = fetch;
  }
});
test('client reports malformed responses and retains conflict details', async () => {
  const fetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('<html>bad gateway</html>', { status: 502 });
    await expect(api('/v1/issues')).rejects.toBeInstanceOf(ApiError);
    globalThis.fetch = async () =>
      Response.json(
        {
          error: {
            code: 'CONFLICT',
            message: 'Stale version',
            details: { current: { version: 2 } },
          },
        },
        { status: 409 },
      );
    try {
      await api('/v1/issues');
      throw new Error('Expected conflict');
    } catch (e) {
      expect(e.details.current.version).toBe(2);
    }
  } finally {
    globalThis.fetch = fetch;
  }
});
test('clean refetched fields never create a fake local draft', () => {
  const initial = snapshotDraft({ title: 'A', description: 'MD', version: 1 });
  expect(isDraftDirty(initial)).toBe(false);
  const server = snapshotDraft({ title: 'Changed on server', description: 'MD', version: 2 });
  expect(isDraftDirty(server)).toBe(false);
  expect(isDraftDirty({ ...initial, title: 'Unsaved' })).toBe(true);
  expect(isDraftDirty({ ...initial, description: 'Unsaved' })).toBe(true);
  expect(isDraftDirty({ ...initial, version: 2 })).toBe(false);
});
