import { test, expect } from 'bun:test';
import { configured } from './linear-live-queue.test.mjs';
import { queueNativeLinearChange } from '../../packages/server/core/linear-events.mjs';
import {
  claimSyncJob,
  finishSyncJob,
  failSyncJob,
  enqueueSyncJob,
} from '../../packages/server/modules/linear-live/store.mjs';
import { reconcileEntityJob } from '../../packages/server/modules/linear-live/engine.mjs';
import { AppError } from '../../packages/server/core/errors.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';
for (const collection of ['issues', 'comments'])
  test(
    collection +
      ' recover a source create after concurrent native text editing without a duplicate or stuck identity',
    async () => {
      const { f, source, actor, config, env } = await configured();
      try {
        const team = targetId(actor.workspace_id, source.ids.org, 'teams', source.ids.team),
          parent = targetId(actor.workspace_id, source.ids.org, 'issues', source.ids.issue);
        const native = (
          await f.request(
            'POST',
            collection === 'issues' ? '/api/v1/issues' : '/api/v1/issues/' + parent + '/comments',
            collection === 'issues'
              ? { team_id: team, title: 'Original title', description: 'Original body' }
              : { body: 'Original body' },
          )
        ).data;
        let remote = null,
          creates = 0;
        const single = collection === 'issues' ? 'issue' : 'comment';
        const fetcher = async (_url, options) => {
          const { query, variables } = JSON.parse(options.body);
          if (query.includes('SyncOrganization'))
            return Response.json({ data: { organization: { id: source.ids.org } } });
          if (query.includes('SyncFind'))
            return Response.json({ data: { [collection]: { nodes: remote ? [remote] : [] } } });
          if (query.includes(single + 'Create')) {
            creates++;
            remote =
              collection === 'issues'
                ? {
                    ...source.data.issues[0],
                    id: native.id,
                    title: 'Original title',
                    description: 'Original body',
                    identifier: 'SRC-99',
                    number: 99,
                    updatedAt: '2026-01-01T00:00:00Z',
                  }
                : {
                    id: native.id,
                    body: 'Original body',
                    issue: { id: source.ids.issue },
                    createdAt: native.created_at,
                    updatedAt: '2026-01-01T00:00:00Z',
                    user: { id: source.ids.user },
                  };
            if (collection === 'issues')
              expect(
                (
                  await f.request('PATCH', '/api/v1/issues/' + native.id, {
                    version: 1,
                    title: 'Concurrent title',
                  })
                ).status,
              ).toBe(200);
            else
              await f.db.transaction((tx) =>
                tx.exec(
                  'UPDATE comments SET body=?,version=version+1 WHERE workspace_id=? AND id=?',
                  ['Concurrent body', actor.workspace_id, native.id],
                ),
              );
            return Response.json({
              data: { [single + 'Create']: { success: true, [single]: remote } },
            });
          }
          if (
            query.includes('SyncEntity') &&
            collection === 'comments' &&
            variables.id === source.ids.issue
          )
            return Response.json({
              data: { issue: source.data.issues.find((r) => r.id === source.ids.issue) },
            });
          if (query.includes('SyncEntity')) return Response.json({ data: { [single]: remote } });
          if (query.includes(single + 'Update')) {
            Object.assign(remote, variables.input, { updatedAt: '2026-01-02T00:00:00Z' });
            return Response.json({
              data: { [single + 'Update']: { success: true, [single]: remote } },
            });
          }
          throw Error('Unexpected source request');
        };
        const job = await f.db.transaction((tx) =>
          enqueueSyncJob(
            tx,
            actor.workspace_id,
            {
              kind: 'entity',
              side: 'native',
              collection,
              sourceId: native.id,
              targetId: native.id,
            },
            'create-race:' + collection,
          ),
        );
        await reconcileEntityJob(f.db, env, job.id, config.generation, { fetcher });
        await f.db.transaction((tx) =>
          tx.exec("UPDATE outbox SET next_attempt_at='2000-01-01T00:00:00Z' WHERE id=?", [job.id]),
        );
        expect(
          (await reconcileEntityJob(f.db, env, job.id, config.generation, { fetcher })).status,
        ).toBe('exported');
        const follow = await f.db.transaction((tx) =>
          enqueueSyncJob(
            tx,
            actor.workspace_id,
            {
              kind: 'entity',
              side: 'native',
              collection,
              sourceId: native.id,
              targetId: native.id,
            },
            'catch-new-text:' + collection,
          ),
        );
        expect(
          (await reconcileEntityJob(f.db, env, follow.id, config.generation, { fetcher })).status,
        ).toBe('converged');
        expect(collection === 'issues' ? remote.title : remote.body).toBe(
          collection === 'issues' ? 'Concurrent title' : 'Concurrent body',
        );
        expect(creates).toBe(1);
      } finally {
        await f.close();
      }
    },
  );
test('an edit queued during a failed job survives a terminal failure as new pending work', async () => {
  const { f, actor, env, config } = await configured();
  try {
    const id = crypto.randomUUID();
    await f.db.transaction((tx) => queueNativeLinearChange(tx, actor, 'documents', id, 1));
    const row = await f.db.transaction((tx) =>
      tx.one("SELECT * FROM outbox WHERE provider='linear' AND event='entity'"),
    );
    const claim = await claimSyncJob(f.db, env, row.id, config.generation);
    await f.db.transaction((tx) => queueNativeLinearChange(tx, actor, 'documents', id, 2));
    await failSyncJob(
      f.db,
      claim,
      new AppError(422, 'TEST_DOMAIN_ERROR', 'Synthetic invalid earlier revision'),
    );
    const current = await f.db.transaction((tx) =>
      tx.one('SELECT status,attempts,payload FROM outbox WHERE id=?', [row.id]),
    );
    expect(current.status).toBe('pending');
    expect(current.attempts).toBe(0);
    expect(JSON.parse(current.payload)._dirty).toBeUndefined();
    const again = await claimSyncJob(f.db, env, row.id, config.generation);
    expect(again).not.toBeNull();
    await f.db.transaction((tx) => finishSyncJob(tx, again, { ok: true }));
  } finally {
    await f.close();
  }
});
