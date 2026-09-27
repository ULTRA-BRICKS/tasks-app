import { test, expect } from 'bun:test';
import { configured } from './linear-live-queue.test.mjs';
import { enqueueSyncJob } from '../../packages/server/modules/linear-live/store.mjs';

test('administrator retries only selected terminal jobs, preserving proof and changing dispatch identity', async () => {
  const { f, source, actor, env } = await configured();
  Object.assign(f.env, env);
  try {
    const job = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        {
          kind: 'entity',
          collection: 'issues',
          sourceId: source.ids.issue,
          deliveryId: crypto.randomUUID(),
        },
        'manual-retry',
      ),
    );
    await f.db.transaction((tx) =>
      tx.exec(
        "UPDATE outbox SET status='failed',attempts=8,last_error='SYNC_BACKPRESSURE' WHERE id=?",
        [job.id],
      ),
    );
    const denied = await f.request(
      'POST',
      '/api/v1/sync/linear/retry',
      { jobIds: [job.id] },
      { anonymous: true },
    );
    expect(denied.status).toBe(401);
    const response = await f.request('POST', '/api/v1/sync/linear/retry', { jobIds: [job.id] });
    expect(response.status).toBe(200);
    expect(response.data.retried).toEqual([job.id]);
    const after = await f.db.transaction((tx) =>
      tx.one('SELECT * FROM outbox WHERE id=?', [job.id]),
    );
    const p = JSON.parse(after.payload);
    expect(after.status).toBe('pending');
    expect(after.attempts).toBe(0);
    expect(p.deliveryId).toBe(JSON.parse(job.payload).deliveryId);
    expect(p._dispatchToken).toBeString();
    expect(p._previousError).toBe('SYNC_BACKPRESSURE');
    expect(
      (await f.request('POST', '/api/v1/sync/linear/retry', { jobIds: [job.id] })).data.retried,
    ).toEqual([]);
  } finally {
    await f.close();
  }
});
