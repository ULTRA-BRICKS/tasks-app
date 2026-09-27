import { test, expect } from 'bun:test';
import { configured } from './linear-live-queue.test.mjs';
import { enqueueSyncJob } from '../../packages/server/modules/linear-live/store.mjs';
import { reconcileScanJob } from '../../packages/server/modules/linear-live/scans.mjs';

test('source scan writes JSON-safe jobs and resumable cursor work without copying lease metadata', async () => {
  const { f, source, actor, env, config } = await configured();
  try {
    const data = {
      kind: 'scan',
      side: 'source',
      collection: 'issues',
      pass: '2026-01-01T00:00:00.000Z',
      cursor: null,
    };
    const job = await f.db.transaction((tx) =>
      enqueueSyncJob(tx, actor.workspace_id, data, 'scan-json-safety'),
    );
    const record = source.data.issues[0];
    const result = await reconcileScanJob(f.db, env, job.id, config.generation, {
      fetcher: async (_url, options) => {
        const query = JSON.parse(options.body).query;
        return Response.json({
          data: query.includes('SyncOrganization')
            ? { organization: { id: source.ids.org } }
            : {
                issues: {
                  nodes: [record],
                  pageInfo: { hasNextPage: true, endCursor: 'cursor-after-first' },
                },
              },
        });
      },
    });
    expect(result.status).toBe('scanned');
    const jobs = await f.db.transaction((tx) =>
      tx.all(
        "SELECT event,payload,status FROM outbox WHERE provider='linear' AND status='pending'",
      ),
    );
    expect(jobs).toHaveLength(2);
    const next = jobs.find((r) => r.event === 'scan');
    expect(JSON.parse(next.payload)).toEqual({ ...data, cursor: 'cursor-after-first' });
    const entity = JSON.parse(jobs.find((r) => r.event === 'entity').payload);
    expect(entity).toEqual({
      kind: 'entity',
      collection: 'issues',
      sourceId: record.id,
      side: 'source',
    });
  } finally {
    await f.close();
  }
});
test('the managed consumer uses the built-in Bun selector rather than a nonexistent community runtime', async () => {
  const config = await Bun.file(new URL('../../vercel.json', import.meta.url)).json();
  expect(config.bunVersion).toBe('1.x');
  expect(config.functions['api/linear-consumer.mjs'].runtime).toBeUndefined();
  expect(config.functions['api/linear-consumer.mjs'].experimentalTriggers[0].topic).toBe(
    'tasks-linear-sync',
  );
});
