import { test, expect } from 'bun:test';
import { buildSchema, parse, validate } from 'graphql';
const sourceSchema = buildSchema(
  await Bun.file(new URL('../../vendor/linear/schema.graphql', import.meta.url)).text(),
);
import { configured } from './linear-live-queue.test.mjs';
import {
  enqueueSyncJob,
  readEntityState,
} from '../../packages/server/modules/linear-live/store.mjs';
import { reconcileEntityJob } from '../../packages/server/modules/linear-live/engine.mjs';
import { processLinearMessage } from '../../packages/server/modules/linear-live/dispatch.mjs';
import { loadNative } from '../../packages/server/modules/linear-live/context.mjs';
import { applyNativePatch } from '../../packages/server/modules/linear-live/domain.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';

test('source team moves preserve identity and change team, status and canonical code atomically', async () => {
  const { f, source, actor, config } = await configured();
  try {
    const team = (await f.request('POST', '/api/v1/teams', { key: 'DST', name: 'Destination' }))
      .data;
    const state = (await f.request('GET', '/api/v1/catalog')).data.statuses.find(
      (item) => item.team_id === team.id && item.category === 'unstarted',
    );
    expect(state?.id).toBeTruthy();
    const id = targetId(actor.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const before = await f.db.transaction((tx) => loadNative(tx, config, 'issues', id));
    await f.db.transaction((tx) =>
      applyNativePatch(
        tx,
        { ...config, actor: { ...actor, syncOrigin: 'linear' } },
        'issues',
        before,
        {
          team_id: team.id,
          status_id: state.id,
          project_id: null,
          cycle_id: null,
          milestone_id: null,
        },
        { identifier: 'DST-42', number: 42 },
      ),
    );
    const after = (await f.request('GET', '/api/v1/issues/' + id)).data;
    expect(after.team_id).toBe(team.id);
    expect(after.status_id).toBe(state.id);
    expect(after.key).toBe('DST-42');
    expect(after.title).toBe(before.title);
  } finally {
    await f.close();
  }
});

test('a superseded deployment acknowledges its obsolete message without claiming or emitting more jobs', async () => {
  const { f, actor, config, env } = await configured();
  try {
    const job = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        { kind: 'entity', collection: 'issues', sourceId: crypto.randomUUID() },
        'obsolete',
      ),
    );
    let sends = 0;
    const result = await processLinearMessage(
      f.db,
      { ...env, VERCEL_DEPLOYMENT_ID: 'different-deployment' },
      { jobId: job.id, generation: config.generation },
      {
        send: async () => {
          sends++;
        },
        fetcher: () => {
          throw Error('Unexpected external request');
        },
      },
    );
    expect(result.status).toBe('inactive-deployment');
    expect(sends).toBe(0);
    expect(
      await f.db.transaction((tx) =>
        tx.one('SELECT status,attempts FROM outbox WHERE id=?', [job.id]),
      ),
    ).toEqual({ status: 'pending', attempts: 0 });
  } finally {
    await f.close();
  }
});

for (const collection of ['projects', 'documents', 'initiatives'])
  test(
    'native ' + collection + ' creation is exported and bound instead of permanently blocked',
    async () => {
      const { f, source, actor, config, env } = await configured();
      try {
        const team = targetId(actor.workspace_id, source.ids.org, 'teams', source.ids.team);
        const native = (
          await f.request(
            'POST',
            '/api/v1/' + collection,
            collection === 'projects'
              ? { name: 'New project', description: 'Keep the complete body', team_ids: [team] }
              : collection === 'documents'
                ? { title: 'New document', body: 'Keep the complete body' }
                : { name: 'New initiative', description: 'Keep the complete body' },
          )
        ).data;
        const single = { projects: 'project', documents: 'document', initiatives: 'initiative' }[
          collection
        ];
        let record = null,
          writes = 0;
        const fetcher = async (_url, options) => {
          const { query, variables } = JSON.parse(options.body);
          const problems = validate(sourceSchema, parse(query));
          expect(problems.map((e) => e.message)).toEqual([]);
          if (query.includes('SyncOrganization'))
            return Response.json({ data: { organization: { id: source.ids.org } } });
          if (query.includes('projectStatuses'))
            return Response.json({
              data: {
                projectStatuses: {
                  nodes: [{ id: crypto.randomUUID(), type: 'planned' }],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            });
          if (query.includes(single + 'Create')) {
            writes++;
            expect(variables.input.id).toBe(native.id);
            record = {
              ...variables.input,
              id: native.id,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              archivedAt: null,
            };
            if (collection === 'projects')
              Object.assign(record, {
                teams: {
                  nodes: [{ id: source.ids.team }],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
                status: { type: 'planned' },
                health: 'on_track',
                lead: null,
                startDate: null,
                targetDate: null,
              });
            if (collection === 'documents')
              Object.assign(record, {
                project: null,
                initiative: null,
                creator: { id: source.ids.user },
              });
            if (collection === 'initiatives')
              Object.assign(record, {
                status: 'Planned',
                owner: null,
                targetDate: null,
                projects: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
              });
            return Response.json({
              data: { [single + 'Create']: { success: true, [single]: record } },
            });
          }
          if (query.includes('SyncFind'))
            return Response.json({ data: { [collection]: { nodes: record ? [record] : [] } } });
          if (query.includes('SyncEntity')) return Response.json({ data: { [single]: record } });
          throw Error('Unexpected source operation: ' + query.slice(0, 80));
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
            'export-' + collection,
          ),
        );
        const result = await reconcileEntityJob(f.db, env, job.id, config.generation, { fetcher });
        expect(result.status).toBe('exported');
        expect(writes).toBe(1);
        const mapped = await f.db.transaction((tx) =>
          tx.one(
            'SELECT target_id FROM linear_source_map WHERE workspace_id=? AND collection=? AND source_id=?',
            [actor.workspace_id, collection, native.id],
          ),
        );
        expect(mapped.target_id).toBe(native.id);
        const state = await f.db.transaction((tx) =>
          readEntityState(tx, actor.workspace_id, collection, native.id),
        );
        expect(state.conflicts).toEqual({});
        const replay = await f.db.transaction((tx) =>
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
            'replay-' + collection,
          ),
        );
        const repeated = await reconcileEntityJob(f.db, env, replay.id, config.generation, {
          fetcher,
        });
        expect(repeated.status).toBe('converged');
        expect(writes).toBe(1);
        const retained = await f.db.transaction((tx) =>
          loadNative(tx, config, collection, native.id),
        );
        expect(retained.version).toBe(native.version);
      } finally {
        await f.close();
      }
    },
  );
