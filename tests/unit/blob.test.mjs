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

test('Blob driver is used behind authenticated HTTP uploads and downloads', async () => {
  const { fixture } = await import('./helpers.mjs');
  const { createApp } = await import('../../packages/server/app.mjs');
  const { createStorage } = await import('../../packages/server/modules/attachments/service.mjs');
  const f = await fixture();
  const files = new Map();
  let gets = 0,
    puts = 0,
    activeTransactions = 0;
  try {
    const sdk = {
      put: async (key, bytes, options) => {
        expect(options.access).toBe('private');
        expect(options.allowOverwrite).toBe(false);
        files.set(key, Buffer.from(bytes));
        puts++;
      },
      get: async (key, options) => {
        expect(activeTransactions).toBe(0);
        expect(options.access).toBe('private');
        gets++;
        const bytes = files.get(key);
        return bytes
          ? {
              statusCode: 200,
              stream: new ReadableStream({
                start(controller) {
                  controller.enqueue(bytes);
                  controller.close();
                },
              }),
            }
          : null;
      },
    };
    const storage = createStorage(
      { STORAGE_DRIVER: 'blob', BLOB_READ_WRITE_TOKEN: 'synthetic-unit-test' },
      { loadBlobSDK: async () => sdk },
    );
    expect(storage.kind).toBe('blob');
    const appDb = {
      ...f.db,
      transaction: async (fn, options) => {
        activeTransactions++;
        try {
          return await f.db.transaction(fn, options);
        } finally {
          activeTransactions--;
        }
      },
    };
    const app = createApp({ db: appDb, env: f.env, storage, logger: { error: () => {} } });
    const issue = (await f.create()).data;
    async function request(method, path, body, anonymous = false, raw = false) {
      return app.fetch(
        new Request('http://localhost:8888' + path, {
          method,
          headers: {
            ...(anonymous ? {} : { cookie: f.session }),
            'x-tickets-csrf': '1',
            origin: f.env.APP_URL,
            'content-type': raw ? 'application/octet-stream' : 'application/json',
          },
          ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }),
        }),
      );
    }
    const text = 'Private HTTP attachment';
    const reserved = await request('POST', '/api/v1/issues/' + issue.id + '/attachments', {
      filename: 'private.txt',
      mime: 'text/plain',
      bytes: Buffer.byteLength(text),
    });
    expect(reserved.status).toBe(201);
    const attachment = await reserved.json();
    const uploaded = await request('PUT', attachment.upload_url, Buffer.from(text), false, true);
    expect(uploaded.ok).toBe(true);
    expect(puts).toBe(1);
    const endpoint = '/api/v1/attachments/' + attachment.id + '/content';
    const forbidden = await request('GET', endpoint, undefined, true);
    expect(forbidden.status).toBe(401);
    expect(gets).toBe(0);
    const response = await request('GET', endpoint);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(text);
    expect(gets).toBe(1);
    expect(
      (await request('PUT', attachment.upload_url, Buffer.from(text), false, true)).status,
    ).toBe(409);
    expect(puts).toBe(1);
  } finally {
    await f.close();
  }
});
