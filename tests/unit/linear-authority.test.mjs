import { test, expect } from 'bun:test';
import { configured } from './linear-live-queue.test.mjs';
import { enqueueSyncJob } from '../../packages/server/modules/linear-live/store.mjs';
import { reconcileEntityJob } from '../../packages/server/modules/linear-live/engine.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';
test('native creation uses a pending identity, then exactly one Linear number, including retries', async () => {
  const { f, source, actor, env, config } = await configured();
  try {
    const teamId = targetId(actor.workspace_id, source.ids.org, 'teams', source.ids.team);
    await f.db.transaction((tx) =>
      tx.exec(
        "INSERT INTO module_settings(workspace_id,module,enabled,config) VALUES(?,'linear-numbering',1,?)",
        [actor.workspace_id, JSON.stringify({ authority: 'linear', teamIds: [teamId] })],
      ),
    );
    const made = await f.request(
      'POST',
      '/api/v1/issues',
      { team_id: teamId, title: 'Created in Tasks' },
      { headers: { 'idempotency-key': 'canonical-create-test' } },
    );
    expect(made.status).toBe(201);
    expect(made.data.key.startsWith('PENDING-')).toBe(true);
    expect(made.data.number).toBeLessThan(0);
    let record = null,
      creates = 0;
    const fetcher = async (_url, options) => {
      const { query, variables } = JSON.parse(options.body);
      if (query.includes('SyncOrganization'))
        return Response.json({ data: { organization: { id: source.ids.org } } });
      if (query.includes('SyncFindIssue'))
        return Response.json({ data: { issues: { nodes: record ? [record] : [] } } });
      if (query.includes('SyncEntity')) return Response.json({ data: { issue: record } });
      if (query.includes('issueCreate')) {
        creates++;
        record = {
          ...source.data.issues[0],
          id: variables.input.id,
          title: variables.input.title,
          description: variables.input.description,
          identifier: 'SRC-3000',
          number: 3000,
          createdAt: variables.input.createdAt,
          updatedAt: '2026-09-25T10:00:00Z',
        };
        return Response.json({ data: { issueCreate: { success: true, issue: record } } });
      }
      throw Error('Unexpected source request');
    };
    const job = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        {
          kind: 'entity',
          collection: 'issues',
          sourceId: made.data.id,
          targetId: made.data.id,
          side: 'native',
        },
        'new-native',
      ),
    );
    await reconcileEntityJob(f.db, env, job.id, config.generation, { fetcher });
    const current = (await f.request('GET', '/api/v1/issues/' + made.data.id)).data;
    expect(current.key).toBe('SRC-3000');
    expect(current.number).toBe(3000);
    expect(current.id).toBe(made.data.id);
    expect(creates).toBe(1);
    await reconcileEntityJob(f.db, env, job.id, config.generation, { fetcher });
    expect(creates).toBe(1);
    const retry = await f.request(
      'POST',
      '/api/v1/issues',
      { team_id: teamId, title: 'Created in Tasks' },
      { headers: { 'idempotency-key': 'canonical-create-test' } },
    );
    expect(retry.data.id).toBe(made.data.id);
    expect(retry.data.key).toBe('SRC-3000');
  } finally {
    await f.close();
  }
});

test('a newly authored native comment is exported once with its stable UUID and unchanged body', async () => {
  const { f, source, actor, env, config } = await configured();
  try {
    const target = targetId(actor.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const made = (
      await f.request('POST', '/api/v1/issues/' + target + '/comments', { body: 'Native comment' })
    ).data;
    let record = null,
      creates = 0;
    const fetcher = async (_url, options) => {
      const { query, variables } = JSON.parse(options.body);
      if (query.includes('SyncOrganization'))
        return Response.json({ data: { organization: { id: source.ids.org } } });
      if (query.includes('SyncFindComment'))
        return Response.json({ data: { comments: { nodes: record ? [record] : [] } } });
      if (query.includes('commentCreate')) {
        creates++;
        record = {
          id: variables.input.id,
          body: variables.input.body,
          createdAt: variables.input.createdAt,
          updatedAt: variables.input.createdAt,
          issue: { id: variables.input.issueId },
          user: { id: source.ids.user },
          archivedAt: null,
          parent: null,
        };
        return Response.json({ data: { commentCreate: { success: true, comment: record } } });
      }
      throw Error('Unexpected source call');
    };
    const job = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        {
          kind: 'entity',
          collection: 'comments',
          sourceId: made.id,
          targetId: made.id,
          side: 'native',
        },
        'new-native-comment',
      ),
    );
    await reconcileEntityJob(f.db, env, job.id, config.generation, { fetcher });
    expect(creates).toBe(1);
    expect(record.body).toBe(made.body);
    expect(record.id).toBe(made.id);
    const mapping = await f.db.transaction((tx) =>
      tx.one(
        "SELECT target_id FROM linear_source_map WHERE workspace_id=? AND collection='comments' AND source_id=?",
        [actor.workspace_id, made.id],
      ),
    );
    expect(mapping.target_id).toBe(made.id);
  } finally {
    await f.close();
  }
});
