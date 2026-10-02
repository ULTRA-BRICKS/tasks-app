import { test, expect } from 'bun:test';
import assert from 'node:assert/strict';
import { createBlobStorage } from '../../packages/server/modules/attachments/blob.mjs';
function fixture() {
  const objects = new Map(),
    calls = [];
  const sdk = {
    put: async (key, bytes, options) => {
      calls.push(options);
      if (objects.has(key)) throw new Error('Already exists');
      objects.set(key, Buffer.from(bytes));
    },
    get: async (key, options) => {
      calls.push(options);
      return objects.has(key)
        ? { statusCode: 200, stream: new Blob([objects.get(key)]).stream() }
        : null;
    },
  };
  return {
    objects,
    calls,
    storage: createBlobStorage(
      { BLOB_READ_WRITE_TOKEN: 'synthetic-unit-only' },
      { loadSDK: async () => sdk, maxBytes: 10 },
    ),
  };
}
test('Blob adapter always requests private access and immutable object keys', async () => {
  const f = fixture();
  await f.storage.put('workspace/id', Buffer.from('hello'), 'text/plain');
  expect((await f.storage.download('workspace/id')).bytes.toString()).toBe('hello');
  expect(f.calls.every((c) => c.access === 'private')).toBe(true);
  expect(f.calls[0].allowOverwrite).toBe(false);
  expect(f.calls[0].addRandomSuffix).toBe(false);
});
test('identical ambiguous Blob upload is recoverable without overwriting', async () => {
  const f = fixture();
  await f.storage.put('key', Buffer.from('hello'), 'text/plain');
  await f.storage.put('key', Buffer.from('hello'), 'text/plain');
  await assert.rejects(() => f.storage.put('key', Buffer.from('changed'), 'text/plain'), {
    code: 'OBJECT_EXISTS',
  });
  expect(f.objects.get('key').toString()).toBe('hello');
});
test('Blob downloads enforce missing files and bounded streams', async () => {
  const f = fixture();
  await assert.rejects(() => f.storage.download('missing'), { code: 'NOT_FOUND' });
  f.objects.set('large', Buffer.alloc(20));
  await assert.rejects(() => f.storage.download('large'), /exceeds/);
  expect(() => createBlobStorage({})).toThrow('not configured');
});
