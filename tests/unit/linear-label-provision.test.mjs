import assert from 'node:assert/strict';
import { test, expect } from 'bun:test';
import { configured } from './linear-live-queue.test.mjs';
import { sourceFixture } from './linear-import-fixture.mjs';
import { enqueueSyncJob, claimSyncJob } from '../../packages/server/modules/linear-live/store.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';
import { ensureIssueLabels } from '../../packages/server/modules/linear-live/provision-labels.mjs';

async function setup() {
  const source = sourceFixture();
  source.data.issueLabels[0].team = { id: crypto.randomUUID() };
  const c = await configured(source);
  c.nativeId = targetId(c.config.workspaceId, source.ids.org, 'issues', source.ids.issue);
  c.nativeLabel = targetId(c.config.workspaceId, source.ids.org, 'issueLabels', source.ids.label);
  const queued = await c.f.db.transaction((tx) =>
    enqueueSyncJob(
      tx,
      c.config.workspaceId,
      {
        kind: 'entity',
        collection: 'issues',
        sourceId: source.ids.issue,
        targetId: c.nativeId,
        side: 'native',
      },
      crypto.randomUUID(),
    ),
  );
  c.job = await claimSyncJob(c.f.db, c.env, queued.id, c.config.generation);
  return c;
}
function server(c, { lost = false } = {}) {
  const state = { record: null, creates: 0, queries: 0 };
  state.fetcher = async (url, options) => {
    expect(url).toBe('https://api.linear.app/graphql');
    const { query, variables } = JSON.parse(options.body);
    state.queries++;
    if (query.includes('ProvisionLookup'))
      return Response.json({
        data: {
          issueLabels: {
            nodes: state.record ? [state.record] : [],
            pageInfo: { hasNextPage: false },
          },
        },
      });
    if (query.includes('ProvisionCreate')) {
      state.creates++;
      expect(variables.input.teamId).toBe(c.source.ids.team);
      state.record = {
        ...c.source.data.issueLabels[0],
        id: variables.input.id,
        team: { id: variables.input.teamId },
        isGroup: false,
      };
      if (lost) {
        lost = false;
        return new Response('temporary response failure', { status: 502 });
      }
      return Response.json({
        data: { issueLabelCreate: { success: true, issueLabel: state.record } },
      });
    }
    throw Error('Unexpected source operation');
  };
  return state;
}
test('missing team alias is provisioned once, preserving the original native label and foreign alias', async () => {
  const c = await setup();
  try {
    const upstream = server(c);
    await ensureIssueLabels(c.f.db, c.env, c.job, c.nativeId, { fetcher: upstream.fetcher });
    const rows = await c.f.db.transaction((tx) =>
      tx.all(
        'SELECT source_id,target_id FROM linear_source_map WHERE workspace_id=? AND collection=? AND target_id=?',
        [c.config.workspaceId, 'issueLabels', c.nativeLabel],
      ),
    );
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.source_id === c.source.ids.label)).toBe(true);
    expect(rows.some((r) => r.source_id === upstream.record.id)).toBe(true);
    expect(upstream.creates).toBe(1);
    await ensureIssueLabels(c.f.db, c.env, c.job, c.nativeId, { fetcher: upstream.fetcher });
    expect(upstream.creates).toBe(1);
  } finally {
    await c.f.close();
  }
});
test('lost label-create response reuses the persisted v4 UUID and does not create a duplicate', async () => {
  const c = await setup();
  try {
    const upstream = server(c, { lost: true });
    await assert.rejects(
      ensureIssueLabels(c.f.db, c.env, c.job, c.nativeId, { fetcher: upstream.fetcher }),
    );
    const createdId = upstream.record.id;
    expect(createdId[14]).toBe('4');
    await ensureIssueLabels(c.f.db, c.env, c.job, c.nativeId, { fetcher: upstream.fetcher });
    expect(upstream.creates).toBe(1);
    expect(
      (
        await c.f.db.transaction((tx) =>
          tx.one(
            'SELECT target_id FROM linear_source_map WHERE workspace_id=? AND collection=? AND source_id=?',
            [c.config.workspaceId, 'issueLabels', createdId],
          ),
        )
      ).target_id,
    ).toBe(c.nativeLabel);
  } finally {
    await c.f.close();
  }
});
test('source label lookup never accepts a foreign team or incomplete page as a matching alias', async () => {
  const c = await setup();
  try {
    for (const page of [
      {
        nodes: [{ ...c.source.data.issueLabels[0], isGroup: false }],
        pageInfo: { hasNextPage: false },
      },
      { nodes: [], pageInfo: { hasNextPage: true } },
    ]) {
      await assert.rejects(
        ensureIssueLabels(c.f.db, c.env, c.job, c.nativeId, {
          fetcher: async () => Response.json({ data: { issueLabels: page } }),
        }),
      );
    }
  } finally {
    await c.f.close();
  }
});

test('normal issue export provisions the missing label before creating the source task', async () => {
  const source = sourceFixture();
  source.data.issueLabels[0].team = { id: crypto.randomUUID() };
  const c = await configured(source);
  try {
    const nativeLabel = targetId(
      c.config.workspaceId,
      source.ids.org,
      'issueLabels',
      source.ids.label,
    );
    const nativeTeam = targetId(c.config.workspaceId, source.ids.org, 'teams', source.ids.team);
    await c.f.db.transaction((tx) =>
      tx.exec(
        "INSERT INTO module_settings(workspace_id,module,enabled,config) VALUES(?,'linear-numbering',1,?)",
        [c.config.workspaceId, JSON.stringify({ authority: 'linear', teamIds: [nativeTeam] })],
      ),
    );
    const made = await c.f.request('POST', '/api/v1/issues', {
      team_id: nativeTeam,
      title: 'Missing-team-label task',
      label_ids: [nativeLabel],
    });
    expect(made.status).toBe(201);
    const queued = await c.f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        c.config.workspaceId,
        {
          kind: 'entity',
          collection: 'issues',
          targetId: made.data.id,
          sourceId: made.data.id,
          side: 'native',
        },
        'automatic-label-create',
      ),
    );
    const upstream = server(c);
    let issueCreates = 0;
    const { reconcileEntityJob } =
      await import('../../packages/server/modules/linear-live/engine.mjs');
    const result = await reconcileEntityJob(c.f.db, c.env, queued.id, c.config.generation, {
      fetcher: async (url, options) => {
        const { query, variables } = JSON.parse(options.body);
        if (query.includes('SyncOrganization'))
          return Response.json({ data: { organization: { id: source.ids.org } } });
        if (query.includes('Provision')) return upstream.fetcher(url, options);
        if (query.includes('SyncFindIssue'))
          return Response.json({ data: { issues: { nodes: [] } } });
        if (query.includes('SyncCreateIssue')) {
          issueCreates++;
          expect(upstream.record).not.toBeNull();
          expect(variables.input.labelIds).toEqual([upstream.record.id]);
          const issue = {
            ...source.data.issues.find((r) => r.id === source.ids.issue),
            id: made.data.id,
            title: variables.input.title,
            description: variables.input.description,
            identifier: 'SRC-100',
            number: 100,
            createdAt: variables.input.createdAt,
            updatedAt: variables.input.createdAt,
            labelIds: variables.input.labelIds,
            parent: null,
            project: null,
            cycle: null,
            projectMilestone: null,
            assignee: null,
          };
          return Response.json({ data: { issueCreate: { success: true, issue } } });
        }
        throw Error('Unexpected test query');
      },
    });
    expect(result.status).toBe('exported');
    expect(issueCreates).toBe(1);
    expect(upstream.creates).toBe(1);
    const native = (await c.f.request('GET', '/api/v1/issues/' + made.data.id)).data;
    expect(native.key).toBe('SRC-100');
    expect(native.label_ids).toEqual([nativeLabel]);
  } finally {
    await c.f.close();
  }
});
