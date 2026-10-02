import { test, expect } from 'bun:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { sourceFixture } from './linear-import-fixture.mjs';
import { createApp } from '../../packages/server/app.mjs';
import { hmac } from '../../packages/server/core/crypto.mjs';
import { runWorker } from '../../packages/server/modules/integrations/service.mjs';

async function ready() {
  const f = await fixture(),
    source = sourceFixture();
  const run = (await f.request('POST', '/api/v1/imports/linear', { manifest: source.manifest }))
    .data.id;
  for (const [collection, records] of Object.entries(source.data))
    if (records.length)
      assert.equal(
        (await f.request('POST', `/api/v1/imports/linear/${run}/records`, { collection, records }))
          .status,
        200,
      );
  const plan = (await f.request('POST', `/api/v1/imports/linear/${run}/plan`)).data;
  assert.equal(
    (await f.request('POST', `/api/v1/imports/linear/${run}/apply`, { plan_hash: plan.plan_hash }))
      .status,
    200,
  );
  Object.assign(f.env, {
    LINEAR_SYNC_WORKSPACE_ID: f.init.workspace_id,
    LINEAR_WEBHOOK_ORGANIZATION_ID: source.ids.org,
    LINEAR_WEBHOOK_ID: crypto.randomUUID(),
    LINEAR_WEBHOOK_SECRET: 'test-signing-secret-not-an-api-key',
  });
  return { f, source };
}
function event(f, source, patch = {}) {
  return {
    type: 'Issue',
    action: 'remove',
    organizationId: source.ids.org,
    webhookId: f.env.LINEAR_WEBHOOK_ID,
    createdAt: '2026-09-25T00:00:00.000Z',
    webhookTimestamp: Date.now(),
    data: { id: source.ids.issue, title: 'Private source body must not appear in status' },
    ...patch,
  };
}
function signed(f, data, id = crypto.randomUUID()) {
  const raw = JSON.stringify(data);
  return {
    raw,
    headers: { 'linear-signature': hmac(f.env.LINEAR_WEBHOOK_SECRET, raw), 'linear-delivery': id },
  };
}
async function deliver(f, data, id) {
  const s = signed(f, data, id);
  return f.request('POST', '/api/webhooks/linear', s.raw, {
    raw: true,
    anonymous: true,
    noCsrf: true,
    headers: s.headers,
  });
}

test('capture persists a verified remove without modifying tasks, accounts or local history', async () => {
  const { f, source } = await ready();
  try {
    const before = await f.db.transaction((tx) =>
      tx.all('SELECT id,title,description,version,deleted_at FROM issues ORDER BY id'),
    );
    const delivery = crypto.randomUUID(),
      body = event(f, source),
      result = await deliver(f, body, delivery);
    expect(result.status).toBe(200);
    expect(result.data.mode).toBe('capture-only');
    expect(result.data.applied).toBe(false);
    const stored = await f.db.transaction((tx) =>
      tx.one("SELECT * FROM webhook_deliveries WHERE provider='linear' AND delivery_id=?", [
        delivery,
      ]),
    );
    expect(stored.status).toBe('captured');
    expect(JSON.parse(stored.payload).event).toEqual(body);
    expect(
      await f.db.transaction((tx) =>
        tx.all('SELECT id,title,description,version,deleted_at FROM issues ORDER BY id'),
      ),
    ).toEqual(before);
    const status = await f.request('GET', '/api/v1/sync/linear/status');
    expect(status.status).toBe(200);
    expect(status.data.received).toBe(1);
    expect(status.data.automaticApplicationEnabled).toBe(false);
    expect(JSON.stringify(status.data)).not.toContain(body.data.title);
    expect(JSON.stringify(status.data)).not.toContain(f.env.LINEAR_WEBHOOK_SECRET);
    expect(
      (await f.request('GET', '/api/v1/sync/linear/status', undefined, { anonymous: true })).status,
    ).toBe(401);
  } finally {
    await f.close();
  }
});
test('retries ignore transport send time but cannot silently replace a different source event', async () => {
  const { f, source } = await ready();
  try {
    const id = crypto.randomUUID(),
      payload = event(f, source);
    expect((await deliver(f, payload, id)).status).toBe(200);
    const retry = await deliver(f, { ...payload, webhookTimestamp: Date.now() + 1 }, id);
    expect(retry.status).toBe(200);
    expect(retry.data.duplicate).toBe(true);
    expect((await deliver(f, { ...payload, action: 'update' }, id)).status).toBe(409);
    const rows = await f.db.transaction((tx) =>
      tx.all("SELECT payload FROM webhook_deliveries WHERE provider='linear'"),
    );
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].payload).event.action).toBe('remove');
  } finally {
    await f.close();
  }
});
test('signature, webhook, organization and delivery timestamp checks precede inbox writes', async () => {
  const { f, source } = await ready();
  try {
    const body = event(f, source);
    expect(
      (
        await f.request('POST', '/api/webhooks/linear', '{}', {
          raw: true,
          anonymous: true,
          noCsrf: true,
        })
      ).status,
    ).toBe(401);
    expect((await deliver(f, { ...body, organizationId: crypto.randomUUID() })).status).toBe(403);
    expect((await deliver(f, { ...body, webhookId: crypto.randomUUID() })).status).toBe(403);
    expect((await deliver(f, { ...body, webhookTimestamp: Date.now() - 120000 })).status).toBe(401);
    let transactions = 0;
    const app = createApp({
      db: {
        transaction: () => {
          transactions++;
          throw Error('Unexpected connection checkout');
        },
      },
      env: f.env,
      logger: { error() {} },
    });
    const response = await app.fetch(
      new Request('http://localhost/api/webhooks/linear', { method: 'POST', body: '{}' }),
    );
    expect(response.status).toBe(401);
    expect(transactions).toBe(0);
    expect(
      await f.db.transaction((tx) =>
        tx.all("SELECT id FROM webhook_deliveries WHERE provider='linear'"),
      ),
    ).toHaveLength(0);
  } finally {
    await f.close();
  }
});
test('unknown data-change models are retained and existing workers cannot claim captured deliveries', async () => {
  const { f, source } = await ready();
  try {
    expect((await deliver(f, event(f, source, { type: 'FutureModel' }))).status).toBe(200);
    await runWorker(f.db, f.env, {
      limit: 1,
      fetcher: () => {
        throw Error('Capture must not invoke a source API');
      },
    });
    const rows = await f.db.transaction((tx) =>
      tx.all("SELECT status,event FROM webhook_deliveries WHERE provider='linear'"),
    );
    expect(rows).toEqual([{ status: 'captured', event: 'FutureModel' }]);
    expect(
      await f.db.transaction((tx) => tx.all("SELECT id FROM outbox WHERE provider='linear'")),
    ).toHaveLength(0);
  } finally {
    await f.close();
  }
});
test('oversized bodies are rejected while streaming, without opening a transaction', async () => {
  let consumed = 0,
    checked = 0,
    cancelled = false;
  const data = new ReadableStream({
    pull(c) {
      consumed++;
      c.enqueue(new Uint8Array(600000));
    },
    cancel() {
      cancelled = true;
    },
  });
  const app = createApp({
    db: {
      transaction: () => {
        checked++;
        throw Error('Unexpected SQL');
      },
    },
    env: {
      APP_URL: 'http://localhost:5173',
      AUTH_SECRET: 'a'.repeat(48),
      NODE_ENV: 'test',
      LINEAR_SYNC_WORKSPACE_ID: crypto.randomUUID(),
      LINEAR_WEBHOOK_ORGANIZATION_ID: crypto.randomUUID(),
      LINEAR_WEBHOOK_ID: crypto.randomUUID(),
      LINEAR_WEBHOOK_SECRET: 's'.repeat(32),
    },
    logger: { error() {} },
  });
  const response = await app.fetch(
    new Request('http://localhost/api/webhooks/linear', {
      method: 'POST',
      body: data,
      duplex: 'half',
    }),
  );
  expect(response.status).toBe(413);
  expect(checked).toBe(0);
  expect(consumed).toBeLessThanOrEqual(4);
  expect(cancelled).toBe(true);
});

test('an uncommitted inbox write cannot return an acknowledgement or lose a retried delivery', async () => {
  const { f, source } = await ready();
  try {
    const id = crypto.randomUUID(),
      payload = event(f, source),
      wire = signed(f, payload, id);
    const broken = {
      transaction: (fn, options) =>
        f.db.transaction(
          (tx) =>
            fn({
              ...tx,
              exec: (sql, args) => {
                if (sql.startsWith('INSERT INTO webhook_deliveries'))
                  throw Error('Synthetic persistence failure');
                return tx.exec(sql, args);
              },
            }),
          options,
        ),
    };
    const app = createApp({ db: broken, env: f.env, logger: { error() {} } });
    const response = await app.fetch(
      new Request('http://localhost/api/webhooks/linear', {
        method: 'POST',
        headers: wire.headers,
        body: wire.raw,
      }),
    );
    expect(response.status).toBe(500);
    expect(
      await f.db.transaction((tx) =>
        tx.all("SELECT id FROM webhook_deliveries WHERE provider='linear'"),
      ),
    ).toHaveLength(0);
    expect((await deliver(f, payload, id)).status).toBe(200);
  } finally {
    await f.close();
  }
});
test('validly signed source data cannot cross the configured imported workspace', async () => {
  const { f, source } = await ready();
  try {
    f.env.LINEAR_WEBHOOK_ORGANIZATION_ID = crypto.randomUUID();
    const result = await deliver(
      f,
      event(f, source, { organizationId: f.env.LINEAR_WEBHOOK_ORGANIZATION_ID }),
    );
    expect(result.status).toBe(403);
    expect(
      await f.db.transaction((tx) =>
        tx.all("SELECT id FROM webhook_deliveries WHERE provider='linear'"),
      ),
    ).toHaveLength(0);
    await f.db.transaction((tx) =>
      tx.exec("UPDATE memberships SET role='viewer' WHERE workspace_id=? AND user_id=?", [
        f.init.workspace_id,
        f.init.user_id,
      ]),
    );
    expect((await f.request('GET', '/api/v1/sync/linear/status')).status).toBe(403);
  } finally {
    await f.close();
  }
});
