import { test, expect } from 'bun:test';
import { configured } from './linear-live-queue.test.mjs';
import { hmac } from '../../packages/server/core/crypto.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';
import {
  verifySourceWebhook,
  receiveSourceWebhook,
} from '../../packages/server/modules/linear-live/webhook.mjs';
import { reconcileEntityJob } from '../../packages/server/modules/linear-live/engine.mjs';
import {
  readEntityState,
  enqueueSyncJob,
} from '../../packages/server/modules/linear-live/store.mjs';
async function delivery(f, source, env, type, id, when) {
  const payload = {
    type,
    action: 'remove',
    organizationId: source.ids.org,
    createdAt: when,
    webhookTimestamp: Date.now(),
    data: { id },
  };
  const raw = Buffer.from(JSON.stringify(payload));
  const event = verifySourceWebhook(
    new Headers({
      'linear-signature': hmac(env.LINEAR_WEBHOOK_SECRET, raw),
      'linear-delivery': crypto.randomUUID(),
    }),
    raw,
    env,
  );
  return f.db.transaction((tx) => receiveSourceWebhook(tx, event, env));
}
test('signed issue and comment removals retain content and expose source lifecycle without inventing accounts', async () => {
  const { f, source, actor, env, config } = await configured();
  try {
    const cases = [
      ['Issue', 'issues', source.ids.issue],
      ['Comment', 'comments', source.data.comments[0].id],
    ];
    const fetcher = async () => Response.json({ data: { organization: { id: source.ids.org } } });
    const issueId = targetId(actor.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const before = (await f.request('GET', '/api/v1/issues/' + issueId)).data;
    for (const [type, collection, id] of cases) {
      const event = await delivery(f, source, env, type, id, '2026-09-25T12:00:00Z');
      await reconcileEntityJob(f.db, env, event.jobId, config.generation, { fetcher });
      const state = await f.db.transaction((tx) =>
        readEntityState(tx, actor.workspace_id, collection, id),
      );
      expect(state.removedAt).toBe('2026-09-25T12:00:00.000Z');
    }
    const after = (await f.request('GET', '/api/v1/issues/' + issueId)).data;
    expect(after.description).toBe(before.description);
    expect(after.deleted_at).toBeNull();
    expect(after.comments.map((c) => c.body)).toEqual(before.comments.map((c) => c.body));
    expect(after.source_sync.removed_at).toBe('2026-09-25T12:00:00.000Z');
    expect(after.comments[0].source_sync.removed_at).toBe('2026-09-25T12:00:00.000Z');
  } finally {
    await f.close();
  }
});
test('unavailable source during update is not proof of removal and cannot erase native content', async () => {
  const { f, source, actor, env, config } = await configured();
  try {
    const job = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        { kind: 'entity', collection: 'issues', sourceId: source.ids.issue, side: 'source' },
        'missing-update',
      ),
    );
    await reconcileEntityJob(f.db, env, job.id, config.generation, {
      fetcher: async (_url, options) =>
        Response.json({
          data: JSON.parse(options.body).query.includes('SyncOrganization')
            ? { organization: { id: source.ids.org } }
            : { issue: null },
        }),
    });
    const state = await f.db.transaction((tx) =>
      readEntityState(tx, actor.workspace_id, 'issues', source.ids.issue),
    );
    expect(state?.removedAt ?? null).toBeNull();
    expect(
      (
        await f.request(
          'GET',
          '/api/v1/issues/' +
            targetId(actor.workspace_id, source.ids.org, 'issues', source.ids.issue),
        )
      ).status,
    ).toBe(200);
  } finally {
    await f.close();
  }
});
test('new canonical source projects preserve content while mapping a source-only lead as attribution', async () => {
  const { f, source, actor, env, config } = await configured();
  try {
    const id = crypto.randomUUID(),
      record = {
        id,
        name: 'New source project',
        description: 'Summary',
        content: 'Full body',
        health: 'on_track',
        startDate: null,
        targetDate: null,
        status: { type: 'planned' },
        lead: { id: source.ids.user },
        teams: {
          nodes: [{ id: source.ids.team }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
        createdAt: '2026-09-24T00:00:00Z',
        updatedAt: '2026-09-25T00:00:00Z',
        archivedAt: null,
      };
    const job = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        { kind: 'entity', collection: 'projects', sourceId: id, side: 'source' },
        'new-project',
      ),
    );
    const result = await reconcileEntityJob(f.db, env, job.id, config.generation, {
      fetcher: async (_url, options) =>
        Response.json({
          data: JSON.parse(options.body).query.includes('SyncOrganization')
            ? { organization: { id: source.ids.org } }
            : { project: record },
        }),
    });
    expect(result.status).toBe('created');
    const mapped = await f.db.transaction((tx) =>
      tx.one(
        "SELECT target_id FROM linear_source_map WHERE workspace_id=? AND collection='projects' AND source_id=?",
        [actor.workspace_id, id],
      ),
    );
    const row = await f.db.transaction((tx) =>
      tx.one('SELECT description,lead_source_id,created_at FROM projects WHERE id=?', [
        mapped.target_id,
      ]),
    );
    expect(row.description).toBe('Full body');
    expect(row.lead_source_id).toBe(
      targetId(actor.workspace_id, source.ids.org, 'users', source.ids.user),
    );
    expect(Date.parse(row.created_at)).toBe(Date.parse(record.createdAt));
  } finally {
    await f.close();
  }
});
