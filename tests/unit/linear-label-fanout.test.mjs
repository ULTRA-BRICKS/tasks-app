import { test, expect } from 'bun:test';
import { configured } from './linear-live-queue.test.mjs';
import { sourceFixture } from './linear-import-fixture.mjs';
import { registerSource } from '../../packages/server/modules/linear-live/context.mjs';
import { enqueueSyncJob, claimSyncJob } from '../../packages/server/modules/linear-live/store.mjs';
import { reconcileEntityJob } from '../../packages/server/modules/linear-live/engine.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';
async function setup() {
  const source = sourceFixture();
  source.data.issueLabels[0].team = { id: source.ids.team };
  const c = await configured(source);
  c.target = targetId(c.actor.workspace_id, source.ids.org, 'issueLabels', source.ids.label);
  c.other = { ...source.data.issueLabels[0], id: crypto.randomUUID(), team: null };
  c.records = new Map([
    [source.ids.label, { ...source.data.issueLabels[0] }],
    [c.other.id, c.other],
  ]);
  await c.f.db.transaction(async (tx) => {
    await registerSource(tx, c.config, 'issueLabels', c.other, c.target);
    await tx.exec('UPDATE labels SET color=? WHERE workspace_id=? AND id=?', [
      '#654321',
      c.actor.workspace_id,
      c.target,
    ]);
  });
  c.parent = await c.f.db.transaction((tx) =>
    enqueueSyncJob(
      tx,
      c.actor.workspace_id,
      {
        kind: 'entity',
        collection: 'issueLabels',
        side: 'native',
        targetId: c.target,
        sourceId: c.target,
      },
      'alias-fanout',
    ),
  );
  c.fetcher = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    if (query.includes('SyncOrganization'))
      return Response.json({ data: { organization: { id: source.ids.org } } });
    const record = c.records.get(variables.id);
    if (query.includes('SyncEntity')) return Response.json({ data: { issueLabel: record } });
    if (query.includes('issueLabelUpdate')) {
      Object.assign(record, variables.input, { updatedAt: '2026-10-14T12:00:00.000Z' });
      return Response.json({ data: { issueLabelUpdate: { success: true, issueLabel: record } } });
    }
    throw Error('Unexpected source operation');
  };
  c.children = () =>
    c.f.db.transaction((tx) =>
      tx.all(
        "SELECT * FROM outbox WHERE workspace_id=? AND provider='linear' AND event='entity' AND payload LIKE ?",
        [c.actor.workspace_id, '%"_parentJobId":"' + c.parent.id + '"%'],
      ),
    );
  return c;
}
test('one native label edit delegates to every confirmed source alias without unbinding or guessing', async () => {
  const c = await setup();
  try {
    expect(await claimSyncJob(c.f.db, c.env, c.parent.id, c.config.generation)).toBeNull();
    const rows = await c.children();
    expect(rows).toHaveLength(2);
    for (const row of rows)
      expect(
        (
          await reconcileEntityJob(c.f.db, c.env, row.id, c.config.generation, {
            fetcher: c.fetcher,
          })
        ).status,
      ).toBe('converged');
    expect([...c.records.values()].every((r) => r.color === '#654321')).toBe(true);
    const aliasCount = await c.f.db.transaction((tx) =>
      tx.one(
        'SELECT count(*) AS n FROM linear_source_map WHERE workspace_id=? AND collection=? AND target_id=?',
        [c.actor.workspace_id, 'issueLabels', c.target],
      ),
    );
    expect(Number(aliasCount.n)).toBe(2);
    await claimSyncJob(c.f.db, c.env, c.parent.id, c.config.generation);
    expect(await c.children()).toHaveLength(2);
  } finally {
    await c.f.close();
  }
});
test('a successful label alias must not retire the failure of another alias sharing the native label', async () => {
  const c = await setup();
  try {
    await claimSyncJob(c.f.db, c.env, c.parent.id, c.config.generation);
    const rows = await c.children();
    expect(rows).toHaveLength(2);
    const failed = rows.find((r) => JSON.parse(r.payload).sourceId === c.other.id);
    const good = rows.find((r) => r.id !== failed.id);
    const denied = async (url, options) =>
      JSON.parse(options.body).query.includes('SyncEntity')
        ? Response.json({ errors: [{ extensions: { code: 'FORBIDDEN' } }] })
        : c.fetcher(url, options);
    expect(
      (await reconcileEntityJob(c.f.db, c.env, failed.id, c.config.generation, { fetcher: denied }))
        .status,
    ).toBe('failed');
    expect(
      (
        await reconcileEntityJob(c.f.db, c.env, good.id, c.config.generation, {
          fetcher: c.fetcher,
        })
      ).status,
    ).toBe('converged');
    const row = await c.f.db.transaction((tx) =>
      tx.one('SELECT status,last_error FROM outbox WHERE id=?', [failed.id]),
    );
    expect(row.status).toBe('blocked');
    expect(row.last_error).toBe('SOURCE_ACCESS_DENIED');
  } finally {
    await c.f.close();
  }
});
