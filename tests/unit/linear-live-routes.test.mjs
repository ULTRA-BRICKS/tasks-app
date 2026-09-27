import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
import { createApp } from '../../packages/server/app.mjs';
test('invalid source webhook never checks out a database transaction', async () => {
  let connections = 0;
  const db = {
    transaction: () => {
      connections++;
      throw Error('Premature DB access');
    },
  };
  const app = createApp({
    db,
    env: {
      APP_URL: 'http://localhost',
      LINEAR_SYNC_WORKSPACE_ID: crypto.randomUUID(),
      LINEAR_WEBHOOK_SECRET: 'secret',
    },
    logger: { error() {} },
  });
  const result = await app.fetch(
    new Request('http://localhost/api/webhooks/linear', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  );
  expect(result.status).toBe(401);
  expect(connections).toBe(0);
});
test('sync management routes require authenticated administrator permissions', async () => {
  const f = await fixture();
  try {
    expect(
      (await f.request('GET', '/api/v1/sync/linear/status', undefined, { anonymous: true })).status,
    ).toBe(401);
    await f.db.transaction((tx) =>
      tx.exec("UPDATE memberships SET role='viewer' WHERE workspace_id=? AND user_id=?", [
        f.init.workspace_id,
        f.init.user_id,
      ]),
    );
    expect((await f.request('POST', '/api/v1/sync/linear/reconcile', {})).status).toBe(403);
  } finally {
    await f.close();
  }
});

test('oversized webhook bodies are canceled before a database checkout or signature work', async () => {
  let connections = 0,
    canceled = false;
  const app = createApp({
    db: {
      transaction() {
        connections++;
        throw Error('No database permitted');
      },
    },
    env: {
      APP_URL: 'http://localhost',
      LINEAR_SYNC_WORKSPACE_ID: crypto.randomUUID(),
      LINEAR_WEBHOOK_SECRET: 'secret',
    },
    logger: { error() {} },
  });
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(600000));
    },
    cancel() {
      canceled = true;
    },
  });
  const response = await app.fetch(
    new Request('http://localhost/api/webhooks/linear', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    }),
  );
  expect(response.status).toBe(413);
  expect(canceled).toBe(true);
  expect(connections).toBe(0);
});
