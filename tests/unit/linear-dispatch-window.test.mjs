import { test, expect } from 'bun:test';
import { configured } from './linear-live-queue.test.mjs';
import { enqueueSyncJob } from '../../packages/server/modules/linear-live/store.mjs';
import { dispatchLinearJobs } from '../../packages/server/modules/linear-live/dispatch.mjs';
test('a durable unclaimed job can be republished after the recovery window rather than deduped for a day', async () => {
  const { f, actor, env, source } = await configured();
  try {
    await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        { kind: 'entity', collection: 'issues', sourceId: source.ids.issue, side: 'source' },
        'unclaimed-recovery',
      ),
    );
    const keys = [];
    const send = async (_topic, _data, options) => {
      keys.push(options.idempotencyKey);
    };
    await dispatchLinearJobs(f.db, env, { send, clock: () => 120000 });
    await dispatchLinearJobs(f.db, env, { send, clock: () => 120001 });
    await dispatchLinearJobs(f.db, env, { send, clock: () => 240000 });
    expect(keys).toHaveLength(3);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  } finally {
    await f.close();
  }
});
test('managed consumer uses the SDK visibilityTimeoutSeconds option', async () => {
  const source = await Bun.file(new URL('../../api/linear-consumer.mjs', import.meta.url)).text();
  expect(source).toMatch(/visibilityTimeoutSeconds:\s*90/);
  expect(source).not.toMatch(/visibilityTimeout:/);
});
