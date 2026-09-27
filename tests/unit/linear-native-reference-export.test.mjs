import { test, expect } from 'bun:test';
import { configured } from './linear-live-queue.test.mjs';
import { enqueueSyncJob } from '../../packages/server/modules/linear-live/store.mjs';
import { reconcileEntityJob } from '../../packages/server/modules/linear-live/engine.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';
import { buildSchema, parse, validate } from 'graphql';
const schema = buildSchema(
  await Bun.file(new URL('../../vendor/linear/schema.graphql', import.meta.url)).text(),
);
for (const collection of ['issueLabels', 'workflowStates', 'cycles', 'projectMilestones'])
  test(
    'native ' + collection + ' is exported by stable UUID with verified parent mapping',
    async () => {
      const { f, source, actor, env, config } = await configured();
      try {
        const team = targetId(actor.workspace_id, source.ids.org, 'teams', source.ids.team),
          project = targetId(actor.workspace_id, source.ids.org, 'projects', source.ids.project);
        const [path, input] =
          collection === 'issueLabels'
            ? ['labels', { name: 'Brand new label', color: '#808080' }]
            : collection === 'workflowStates'
              ? [
                  'statuses',
                  {
                    name: 'Review stage',
                    color: '#808080',
                    category: 'started',
                    team_id: team,
                    position: 55,
                  },
                ]
              : collection === 'cycles'
                ? [
                    'cycles',
                    {
                      name: 'October',
                      team_id: team,
                      start_date: '2026-10-01',
                      end_date: '2026-10-15',
                    },
                  ]
                : ['milestones', { name: 'Beta', project_id: project, target_date: '2026-10-15' }];
        const response = await f.request('POST', '/api/v1/' + path, input);
        expect(response.status).toBe(201);
        const native = response.data;
        const queued = await f.db.transaction((tx) =>
          tx.all(
            "SELECT payload FROM outbox WHERE workspace_id=? AND provider='linear' AND status='pending'",
            [actor.workspace_id],
          ),
        );
        expect(
          queued.some((r) => {
            const p = JSON.parse(r.payload);
            return p.collection === collection && p.targetId === native.id;
          }),
        ).toBe(true);
        const single = {
          issueLabels: 'issueLabel',
          workflowStates: 'workflowState',
          cycles: 'cycle',
          projectMilestones: 'projectMilestone',
        }[collection];
        let record = null,
          writes = 0;
        const fetcher = async (_url, options) => {
          const { query, variables } = JSON.parse(options.body);
          expect(validate(schema, parse(query)).map((e) => e.message)).toEqual([]);
          if (query.includes('SyncOrganization'))
            return Response.json({ data: { organization: { id: source.ids.org } } });
          if (query.includes('SyncFind'))
            return Response.json({ data: { [collection]: { nodes: record ? [record] : [] } } });
          if (query.includes(single + 'Create')) {
            writes++;
            record = {
              ...variables.input,
              id: native.id,
              createdAt: '2026-09-26T00:00:00Z',
              updatedAt: '2026-09-26T00:00:00Z',
              archivedAt: null,
            };
            if (collection === 'workflowStates' || collection === 'cycles')
              record.team = { id: source.ids.team };
            if (collection === 'projectMilestones') record.project = { id: source.ids.project };
            return Response.json({
              data: { [single + 'Create']: { success: true, [single]: record } },
            });
          }
          if (query.includes('SyncEntity')) return Response.json({ data: { [single]: record } });
          throw Error('Unexpected query');
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
            'reference:' + collection,
          ),
        );
        const result = await reconcileEntityJob(f.db, env, job.id, config.generation, { fetcher });
        expect(result.status).toBe('exported');
        expect(writes).toBe(1);
        const bound = await f.db.transaction((tx) =>
          tx.one(
            'SELECT target_id FROM linear_source_map WHERE workspace_id=? AND collection=? AND source_id=?',
            [actor.workspace_id, collection, native.id],
          ),
        );
        expect(bound.target_id).toBe(native.id);
      } finally {
        await f.close();
      }
    },
  );
