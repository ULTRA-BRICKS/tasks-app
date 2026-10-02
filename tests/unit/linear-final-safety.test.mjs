import assert from 'node:assert/strict';
import { test, expect } from 'bun:test';
import { configured } from './linear-live-queue.test.mjs';
import { configureSync, enqueueSyncJob } from '../../packages/server/modules/linear-live/store.mjs';
import { reconcileEntityJob } from '../../packages/server/modules/linear-live/engine.mjs';
import { sourceInScope } from '../../packages/server/modules/linear-live/scope.mjs';
import { receiveSourceWebhook } from '../../packages/server/modules/linear-live/webhook.mjs';
test('a missing required source team is not workspace-global data', async () => {
  await assert.rejects(() =>
    sourceInScope({}, {}, { teamIds: [crypto.randomUUID()] }, 'issues', {
      id: crypto.randomUUID(),
    }),
  );
});
test('verified retry transport timestamps may change without replacing the stored business event', async () => {
  const { f, source, env } = await configured();
  try {
    const event = {
      deliveryId: crypto.randomUUID(),
      payload: {
        type: 'Issue',
        action: 'update',
        organizationId: source.ids.org,
        createdAt: new Date().toISOString(),
        webhookTimestamp: Date.now(),
        data: { id: source.ids.issue },
      },
    };
    await f.db.transaction((tx) => receiveSourceWebhook(tx, event, env));
    const repeated = await f.db.transaction((tx) =>
      receiveSourceWebhook(
        tx,
        {
          ...event,
          payload: { ...event.payload, webhookTimestamp: event.payload.webhookTimestamp + 30000 },
        },
        env,
      ),
    );
    expect(repeated.duplicate).toBe(true);
    expect(repeated.mismatch).not.toBe(true);
  } finally {
    await f.close();
  }
});
test('new native issues outside selected teams cannot be exported as a side effect', async () => {
  const { f, source, actor, env } = await configured();
  try {
    const config = await f.db.transaction((tx) =>
      configureSync(
        tx,
        actor,
        { organizationId: source.ids.org, enabled: true, teamIds: [crypto.randomUUID()] },
        env,
      ),
    );
    const native = (await f.create({ title: 'Unmanaged native issue' })).data;
    const job = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        {
          kind: 'entity',
          collection: 'issues',
          side: 'native',
          sourceId: native.id,
          targetId: native.id,
        },
        'out-of-scope-export',
      ),
    );
    let writes = 0;
    const result = await reconcileEntityJob(f.db, env, job.id, config.generation, {
      fetcher: async (_url, options) => {
        const query = JSON.parse(options.body).query;
        if (query.startsWith('mutation')) writes++;
        return Response.json({ data: { organization: { id: source.ids.org } } });
      },
    });
    expect(result.status).toBe('out-of-scope');
    expect(writes).toBe(0);
  } finally {
    await f.close();
  }
});
