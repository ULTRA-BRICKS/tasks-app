import assert from 'node:assert/strict';
import { test, expect } from 'bun:test';
import { configured } from './linear-live-queue.test.mjs';
import { normalizedSource } from '../../packages/server/modules/linear-live/model.mjs';
import { applyNativePatch } from '../../packages/server/modules/linear-live/domain.mjs';
import { configureSync, enqueueSyncJob } from '../../packages/server/modules/linear-live/store.mjs';
import { reconcileEntityJob } from '../../packages/server/modules/linear-live/engine.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';

test('canonical initiative enum maps to native values and preserves proposed as source provenance', () => {
  const common = {
    id: crypto.randomUUID(),
    name: 'Initiative',
    description: '',
    projects: { nodes: [] },
  };
  for (const [status, expected] of [
    ['Active', 'active'],
    ['Planned', 'planned'],
    ['Proposed', 'planned'],
    ['Completed', 'completed'],
    ['Canceled', 'canceled'],
  ])
    expect(normalizedSource('initiatives', { ...common, status }, () => null).status).toBe(
      expected,
    );
  expect(() =>
    normalizedSource('initiatives', { ...common, status: 'Invented' }, () => null),
  ).toThrow();
});
test('project team changes persist through the shared domain and are version guarded', async () => {
  const { f, source, actor, config } = await configured();
  try {
    const project = targetId(actor.workspace_id, source.ids.org, 'projects', source.ids.project);
    const next = (await f.request('POST', '/api/v1/teams', { key: 'NEXT', name: 'Second team' }))
      .data;
    const row = await f.db.transaction((tx) =>
      tx.one('SELECT * FROM projects WHERE id=?', [project]),
    );
    await f.db.transaction((tx) =>
      applyNativePatch(tx, configWithActor(config, actor), 'projects', row, {
        team_ids: [next.id],
      }),
    );
    const teams = await f.db.transaction((tx) =>
      tx.all('SELECT team_id FROM project_teams WHERE workspace_id=? AND project_id=?', [
        actor.workspace_id,
        project,
      ]),
    );
    expect(teams.map((r) => r.team_id)).toEqual([next.id]);
    await assert.rejects(
      f.db.transaction((tx) =>
        applyNativePatch(tx, configWithActor(config, actor), 'projects', row, { name: 'Stale' }),
      ),
      (error) => error.code === 'VERSION_CONFLICT',
    );
  } finally {
    await f.close();
  }
});
const configWithActor = (config, actor) => ({
  ...config,
  actor: { ...actor, syncOrigin: 'linear' },
});
test('out-of-scope source issues cannot be created or mutate workspace records', async () => {
  const { f, source, actor, env } = await configured();
  try {
    const other = crypto.randomUUID();
    const config = await f.db.transaction((tx) =>
      configureSync(
        tx,
        actor,
        { organizationId: source.ids.org, enabled: true, teamIds: [other] },
        env,
      ),
    );
    const record = {
      ...source.data.issues[0],
      title: 'Unauthorized scope update',
      updatedAt: '2026-09-25T10:00:00Z',
    };
    const job = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        { kind: 'entity', collection: 'issues', sourceId: record.id, side: 'source' },
        'scope-test',
      ),
    );
    const result = await reconcileEntityJob(f.db, env, job.id, config.generation, {
      fetcher: async (_url, o) =>
        Response.json({
          data: JSON.parse(o.body).query.includes('SyncOrganization')
            ? { organization: { id: source.ids.org } }
            : { issue: record },
        }),
    });
    expect(result.status).toBe('out-of-scope');
    const current = (
      await f.request(
        'GET',
        '/api/v1/issues/' + targetId(actor.workspace_id, source.ids.org, 'issues', record.id),
      )
    ).data;
    expect(current.title).not.toBe(record.title);
    expect(current.version).toBe(1);
  } finally {
    await f.close();
  }
});
