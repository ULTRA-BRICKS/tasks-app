import { test, expect } from 'bun:test';
import { configured } from './linear-live-queue.test.mjs';
import {
  enqueueSyncJob,
  readSyncStatus,
} from '../../packages/server/modules/linear-live/store.mjs';
import { registerSource } from '../../packages/server/modules/linear-live/context.mjs';
import { reconcileEntityJob } from '../../packages/server/modules/linear-live/engine.mjs';
import { reconcileScanJob } from '../../packages/server/modules/linear-live/scans.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';
import { hmac } from '../../packages/server/core/crypto.mjs';
import {
  verifySourceWebhook,
  receiveSourceWebhook,
} from '../../packages/server/modules/linear-live/webhook.mjs';

// Production (29 Sep 2026): Linear labels are team-scoped, native labels are unique per workspace
// by name, so the import binds e.g. GL "Infra" and HYP "Infra" to one native label. Linear rejects
// an issue write naming another team's label, and the job was blocked as SOURCE_QUERY_REJECTED.
const OTHER_TEAM = '00000000-0000-4000-8000-00000000000b';
// Sorts before any random fixture UUID, so an arbitrary first-row choice picks this alias.
const OTHER_TEAM_LABEL = '00000000-0000-4000-8000-000000000001';
const time = { createdAt: '2024-01-02T03:04:05.006Z', updatedAt: '2024-02-03T04:05:06.007Z' };

async function aliasedLabel({ f, source, actor, config }) {
  const nativeLabel = targetId(actor.workspace_id, source.ids.org, 'issueLabels', source.ids.label);
  const extra = (
    await f.request('POST', '/api/v1/labels', { name: 'Native added', color: '#00aa00' })
  ).data;
  const extraSource = crypto.randomUUID();
  await f.db.transaction(async (tx) => {
    await registerSource(
      tx,
      config,
      'issueLabels',
      {
        id: OTHER_TEAM_LABEL,
        name: 'Imported fixture',
        color: '#123456',
        team: { id: OTHER_TEAM },
        parent: null,
        archivedAt: null,
        ...time,
      },
      nativeLabel,
    );
    await registerSource(
      tx,
      config,
      'issueLabels',
      {
        id: extraSource,
        name: 'Native added',
        color: '#00aa00',
        team: { id: source.ids.team },
        parent: null,
        archivedAt: null,
        ...time,
      },
      extra.id,
    );
  });
  return { nativeLabel, extra, extraSource };
}

// A fake Linear transport that enforces the source rule: an issue may only carry labels of its
// own team or workspace labels. A violation is answered like Linear answers invalid input.
function linear(source, remote, labelTeams = []) {
  const teams = new Map([
    [source.ids.label, source.ids.team],
    [OTHER_TEAM_LABEL, OTHER_TEAM],
    ...labelTeams,
  ]);
  const calls = { creates: [], updates: [] };
  const reject = () =>
    Response.json({
      data: null,
      errors: [
        {
          message: 'Argument Validation Error',
          extensions: {
            type: 'invalid input',
            code: 'INPUT_ERROR',
            statusCode: 400,
            userError: true,
            userPresentableMessage: 'Labels must belong to the issue team or the workspace.',
          },
        },
      ],
    });
  const allowed = (team, labelIds = []) =>
    labelIds.every((label) => !teams.has(label) || teams.get(label) === team);
  const fetcher = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    if (query.includes('SyncOrganization'))
      return Response.json({ data: { organization: { id: source.ids.org } } });
    if (query.includes('SyncFindIssue'))
      return Response.json({ data: { issues: { nodes: remote.value ? [remote.value] : [] } } });
    if (query.includes('issueCreate')) {
      calls.creates.push(variables.input);
      if (!allowed(variables.input.teamId, variables.input.labelIds)) return reject();
      const { teamId, stateId, labelIds, ...rest } = variables.input;
      remote.value = {
        ...source.data.issues.find((issue) => issue.id === source.ids.issue),
        ...rest,
        team: { id: teamId },
        state: { id: stateId },
        labelIds,
        parent: null,
        project: null,
        projectMilestone: null,
        assignee: null,
        identifier: 'SRC-99',
        number: 99,
        ...time,
      };
      return Response.json({ data: { issueCreate: { success: true, issue: remote.value } } });
    }
    if (query.includes('issueUpdate')) {
      calls.updates.push(variables.input);
      if (!allowed(remote.value.team.id, variables.input.labelIds)) return reject();
      Object.assign(remote.value, variables.input, { updatedAt: '2026-09-29T20:00:00.000Z' });
      return Response.json({ data: { issueUpdate: { success: true, issue: remote.value } } });
    }
    if (query.includes('SyncEntity')) return Response.json({ data: { issue: remote.value } });
    throw Error('Unexpected source operation');
  };
  return { fetcher, calls };
}
const jobState = (f, id) =>
  f.db.transaction((tx) => tx.one('SELECT status,last_error FROM outbox WHERE id=?', [id]));

test('a native label edit sends the Linear label of the issue team, not a same-name alias of another team', async () => {
  const context = await configured();
  const { f, source, actor, env, config } = context;
  try {
    const { nativeLabel, extra, extraSource } = await aliasedLabel(context);
    const native = targetId(actor.workspace_id, source.ids.org, 'issues', source.ids.issue);
    expect(
      (
        await f.request('PATCH', '/api/v1/issues/' + native, {
          version: 1,
          label_ids: [nativeLabel, extra.id],
        })
      ).status,
    ).toBe(200);
    const remote = { value: { ...source.data.issues.find((r) => r.id === source.ids.issue) } };
    const api = linear(source, remote);
    const job = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        { kind: 'entity', collection: 'issues', sourceId: source.ids.issue, side: 'source' },
        'label-alias-update',
      ),
    );
    const result = await reconcileEntityJob(f.db, env, job.id, config.generation, {
      fetcher: api.fetcher,
    });
    expect(result).toEqual({ status: 'converged' });
    expect(api.calls.updates).toHaveLength(1);
    expect(new Set(api.calls.updates[0].labelIds)).toEqual(
      new Set([source.ids.label, extraSource]),
    );
    expect(await jobState(f, job.id)).toEqual({ status: 'done', last_error: null });
  } finally {
    await f.close();
  }
});

test('the issue team label wins over a workspace label, an unrecorded-scope alias and an archived alias', async () => {
  const context = await configured();
  const { f, source, actor, env, config } = context;
  try {
    // The fixture's imported label record carries no team at all (unknown scope).
    const { nativeLabel, extra, extraSource } = await aliasedLabel(context);
    const workspaceLabel = crypto.randomUUID(),
      teamLabel = crypto.randomUUID(),
      archivedTeamLabel = crypto.randomUUID();
    await f.db.transaction(async (tx) => {
      for (const [id, team, archivedAt] of [
        [workspaceLabel, null, null],
        [teamLabel, { id: source.ids.team }, null],
        [archivedTeamLabel, { id: source.ids.team }, '2026-01-01T00:00:00.000Z'],
      ])
        await registerSource(
          tx,
          config,
          'issueLabels',
          {
            id,
            name: 'Imported fixture',
            color: '#123456',
            team,
            parent: null,
            archivedAt,
            ...time,
          },
          nativeLabel,
        );
    });
    const native = targetId(actor.workspace_id, source.ids.org, 'issues', source.ids.issue);
    expect(
      (
        await f.request('PATCH', '/api/v1/issues/' + native, {
          version: 1,
          label_ids: [nativeLabel, extra.id],
        })
      ).status,
    ).toBe(200);
    const remote = { value: { ...source.data.issues.find((r) => r.id === source.ids.issue) } };
    const api = linear(source, remote);
    const job = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        { kind: 'entity', collection: 'issues', sourceId: source.ids.issue, side: 'source' },
        'label-alias-tiers',
      ),
    );
    expect(
      await reconcileEntityJob(f.db, env, job.id, config.generation, { fetcher: api.fetcher }),
    ).toEqual({ status: 'converged' });
    expect(new Set(api.calls.updates[0].labelIds)).toEqual(new Set([teamLabel, extraSource]));
  } finally {
    await f.close();
  }
});

test('a new task with a label shared by name across teams is created in Linear and gets its code', async () => {
  const context = await configured();
  const { f, source, actor, env, config } = context;
  try {
    const { nativeLabel } = await aliasedLabel(context);
    const team = targetId(actor.workspace_id, source.ids.org, 'teams', source.ids.team);
    // Linear assigns task codes: a task keeps its PENDING key until its Linear create succeeds.
    await f.db.transaction((tx) =>
      tx.exec(
        "INSERT INTO module_settings(workspace_id,module,enabled,config) VALUES(?,'linear-numbering',1,?)",
        [actor.workspace_id, JSON.stringify({ authority: 'linear', teamIds: [team] })],
      ),
    );
    const created = (
      await f.request('POST', '/api/v1/issues', {
        team_id: team,
        title: 'Created with an aliased label',
        label_ids: [nativeLabel],
      })
    ).data;
    expect(created.key).toStartWith('PENDING-');
    const remote = { value: null };
    const api = linear(source, remote);
    const job = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        {
          kind: 'entity',
          side: 'native',
          collection: 'issues',
          sourceId: created.id,
          targetId: created.id,
        },
        'label-alias-create',
      ),
    );
    const result = await reconcileEntityJob(f.db, env, job.id, config.generation, {
      fetcher: api.fetcher,
    });
    expect(result).toEqual({ status: 'exported' });
    expect(api.calls.creates.map((input) => input.labelIds)).toEqual([[source.ids.label]]);
    expect((await f.request('GET', '/api/v1/issues/' + created.id)).data.key).toBe('SRC-99');
  } finally {
    await f.close();
  }
});

test('a native label without a Linear label for the issue team fails explicitly without a source write', async () => {
  const context = await configured();
  const { f, source, actor, env, config } = context;
  try {
    const onlyElsewhere = (
      await f.request('POST', '/api/v1/labels', { name: 'Other team only', color: '#aa0000' })
    ).data;
    const elsewhere = crypto.randomUUID();
    await f.db.transaction((tx) =>
      registerSource(
        tx,
        config,
        'issueLabels',
        {
          id: elsewhere,
          name: 'Other team only',
          color: '#aa0000',
          team: { id: OTHER_TEAM },
          parent: null,
          archivedAt: null,
          ...time,
        },
        onlyElsewhere.id,
      ),
    );
    const native = targetId(actor.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const nativeLabel = targetId(
      actor.workspace_id,
      source.ids.org,
      'issueLabels',
      source.ids.label,
    );
    expect(
      (
        await f.request('PATCH', '/api/v1/issues/' + native, {
          version: 1,
          label_ids: [nativeLabel, onlyElsewhere.id],
        })
      ).status,
    ).toBe(200);
    const remote = { value: { ...source.data.issues.find((r) => r.id === source.ids.issue) } };
    const api = linear(source, remote, [[elsewhere, OTHER_TEAM]]);
    const job = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        { kind: 'entity', collection: 'issues', sourceId: source.ids.issue, side: 'source' },
        'label-unavailable',
      ),
    );
    const result = await reconcileEntityJob(f.db, env, job.id, config.generation, {
      fetcher: api.fetcher,
    });
    expect(result).toEqual({ status: 'failed', code: 'SYNC_LABEL_TEAM_UNAVAILABLE' });
    expect(api.calls.updates).toEqual([]);
    expect(await jobState(f, job.id)).toEqual({
      status: 'blocked',
      last_error: 'SYNC_LABEL_TEAM_UNAVAILABLE',
    });
  } finally {
    await f.close();
  }
});

test('two live labels of the issue team bound to one native label are refused without a source write', async () => {
  const context = await configured();
  const { f, source, actor, env, config } = context;
  try {
    const { nativeLabel, extra } = await aliasedLabel(context);
    const first = crypto.randomUUID(),
      second = crypto.randomUUID();
    await f.db.transaction(async (tx) => {
      for (const id of [first, second])
        await registerSource(
          tx,
          config,
          'issueLabels',
          {
            id,
            name: 'Imported fixture',
            color: '#123456',
            team: { id: source.ids.team },
            parent: null,
            archivedAt: null,
            ...time,
          },
          nativeLabel,
        );
    });
    const native = targetId(actor.workspace_id, source.ids.org, 'issues', source.ids.issue);
    expect(
      (
        await f.request('PATCH', '/api/v1/issues/' + native, {
          version: 1,
          label_ids: [nativeLabel, extra.id],
        })
      ).status,
    ).toBe(200);
    const remote = { value: { ...source.data.issues.find((r) => r.id === source.ids.issue) } };
    const api = linear(source, remote);
    const job = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        { kind: 'entity', collection: 'issues', sourceId: source.ids.issue, side: 'source' },
        'label-alias-tie',
      ),
    );
    expect(
      await reconcileEntityJob(f.db, env, job.id, config.generation, { fetcher: api.fetcher }),
    ).toEqual({ status: 'failed', code: 'SYNC_SOURCE_ALIAS_AMBIGUOUS' });
    expect(api.calls.updates).toEqual([]);
    expect(await jobState(f, job.id)).toEqual({
      status: 'blocked',
      last_error: 'SYNC_SOURCE_ALIAS_AMBIGUOUS',
    });
  } finally {
    await f.close();
  }
});

test('reconcile passes over a still-rejected entity keep one open problem row, cleared once it converges and kept by a stale read', async () => {
  const context = await configured();
  const { f, source, actor, env, config } = context;
  try {
    const native = targetId(actor.workspace_id, source.ids.org, 'issues', source.ids.issue);
    expect(
      (await f.request('PATCH', '/api/v1/issues/' + native, { version: 1, title: 'Native edit' }))
        .status,
    ).toBe(200);
    const record = {
      ...source.data.issues.find((r) => r.id === source.ids.issue),
      updatedAt: '2026-09-27T00:00:00.000Z',
    };
    let rejectWrites = true;
    const fetcher = async (_url, options) => {
      const { query, variables } = JSON.parse(options.body);
      if (query.includes('SyncOrganization'))
        return Response.json({ data: { organization: { id: source.ids.org } } });
      if (query.includes('SyncPage'))
        return Response.json({
          data: { issues: { nodes: [record], pageInfo: { hasNextPage: false, endCursor: null } } },
        });
      if (query.includes('issueUpdate')) {
        if (rejectWrites)
          return Response.json({
            errors: [{ message: 'Rejected', extensions: { code: 'INPUT_ERROR' } }],
          });
        Object.assign(record, variables.input, { updatedAt: '2026-09-28T00:00:00.000Z' });
        return Response.json({ data: { issueUpdate: { success: true, issue: record } } });
      }
      if (query.includes('SyncEntity')) return Response.json({ data: { issue: record } });
      throw Error('Unexpected source operation');
    };
    const pass = async (at) => {
      const scan = await f.db.transaction((tx) =>
        enqueueSyncJob(
          tx,
          actor.workspace_id,
          { kind: 'scan', collection: 'issues', side: 'source', pass: at, cursor: null },
          'scan:issues:' + at,
        ),
      );
      expect(
        (await reconcileScanJob(f.db, env, scan.id, config.generation, { fetcher })).status,
      ).toBe('scanned');
      const entity = await f.db.transaction((tx) =>
        tx.one(
          "SELECT id FROM outbox WHERE provider='linear' AND event='entity' AND status='pending'",
        ),
      );
      return reconcileEntityJob(f.db, env, entity.id, config.generation, { fetcher });
    };
    const status = async () =>
      f.db.transaction((tx) => readSyncStatus(tx, { ...actor, role: 'owner' }, env));

    expect(await pass('2026-09-29T19:27:13.494Z')).toMatchObject({ code: 'SOURCE_QUERY_REJECTED' });
    expect(await pass('2026-09-29T23:47:54.382Z')).toMatchObject({ code: 'SOURCE_QUERY_REJECTED' });
    const rejected = await status();
    expect(rejected.counts.blocked).toBe(1);
    expect(rejected.problems).toHaveLength(1);

    rejectWrites = false;
    expect(await pass('2026-09-30T04:30:00.000Z')).toEqual({ status: 'converged' });
    const converged = await status();
    expect(converged.counts.blocked ?? 0).toBe(0);
    expect(converged.problems).toEqual([]);

    // A job that only saw an older copy of the source decides nothing: the open problem stays.
    const { version } = (await f.request('GET', '/api/v1/issues/' + native)).data;
    expect(
      (await f.request('PATCH', '/api/v1/issues/' + native, { version, title: 'Second edit' }))
        .status,
    ).toBe(200);
    rejectWrites = true;
    expect(await pass('2026-09-30T05:00:00.000Z')).toMatchObject({ code: 'SOURCE_QUERY_REJECTED' });
    record.updatedAt = '2026-09-01T00:00:00.000Z';
    const stale = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        { kind: 'entity', collection: 'issues', sourceId: source.ids.issue, side: 'source' },
        'stale-read',
      ),
    );
    expect(await reconcileEntityJob(f.db, env, stale.id, config.generation, { fetcher })).toEqual({
      status: 'stale',
    });
    expect((await status()).problems).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test('repeated native scans of an ambiguous source alias keep a single blocked row, retired once the alias is resolved', async () => {
  const { f, source, actor, env, config } = await configured();
  try {
    const nativeLabel = targetId(
      actor.workspace_id,
      source.ids.org,
      'issueLabels',
      source.ids.label,
    );
    await f.db.transaction(async (tx) => {
      await registerSource(
        tx,
        config,
        'issueLabels',
        {
          id: OTHER_TEAM_LABEL,
          name: 'Imported fixture',
          color: '#123456',
          team: { id: OTHER_TEAM },
          ...time,
        },
        nativeLabel,
      );
      await tx.exec('UPDATE labels SET color=? WHERE workspace_id=? AND id=?', [
        '#654321',
        actor.workspace_id,
        nativeLabel,
      ]);
    });
    const nativePass = async (pass) => {
      const scan = await f.db.transaction((tx) =>
        enqueueSyncJob(
          tx,
          actor.workspace_id,
          { kind: 'scan', collection: 'issueLabels', side: 'native', pass, cursor: null },
          'native-scan:issueLabels:' + pass,
        ),
      );
      expect((await reconcileScanJob(f.db, env, scan.id, config.generation)).status).toBe(
        'scanned',
      );
      return f.db.transaction((tx) =>
        tx.one(
          "SELECT id FROM outbox WHERE provider='linear' AND event='entity' AND status='pending' AND payload LIKE ?",
          ['%"targetId":"' + nativeLabel + '"%'],
        ),
      );
    };
    const rows = () =>
      f.db.transaction((tx) =>
        tx.all(
          "SELECT status,last_error FROM outbox WHERE provider='linear' AND event='entity' AND payload LIKE ? ORDER BY status",
          ['%"targetId":"' + nativeLabel + '"%'],
        ),
      );
    for (const pass of ['2026-09-29T19:27:13.494Z', '2026-09-29T23:47:54.382Z']) {
      const entity = await nativePass(pass);
      expect(await reconcileEntityJob(f.db, env, entity.id, config.generation)).toEqual({
        status: 'not-claimed',
      });
    }
    expect(await rows()).toEqual([
      { status: 'blocked', last_error: 'SYNC_SOURCE_ALIAS_AMBIGUOUS' },
      { status: 'superseded', last_error: 'SYNC_SOURCE_ALIAS_AMBIGUOUS' },
    ]);

    // An operator resolves the ambiguity by unbinding the other team's alias. The blocked row was
    // keyed by the native UUID (there was no single source UUID), the new job by the source UUID.
    await f.db.transaction((tx) =>
      tx.exec('DELETE FROM linear_source_map WHERE source_id=?', [OTHER_TEAM_LABEL]),
    );
    const label = { ...source.data.issueLabels[0], team: null, parent: null, archivedAt: null };
    const fetcher = async (_url, options) => {
      const { query, variables } = JSON.parse(options.body);
      if (query.includes('SyncOrganization'))
        return Response.json({ data: { organization: { id: source.ids.org } } });
      if (query.includes('SyncEntity')) return Response.json({ data: { issueLabel: label } });
      if (query.includes('issueLabelUpdate')) {
        Object.assign(label, variables.input, { updatedAt: '2026-09-30T05:00:00.000Z' });
        return Response.json({ data: { issueLabelUpdate: { success: true, issueLabel: label } } });
      }
      throw Error('Unexpected source operation');
    };
    const entity = await nativePass('2026-09-30T04:30:00.000Z');
    expect(await reconcileEntityJob(f.db, env, entity.id, config.generation, { fetcher })).toEqual({
      status: 'converged',
    });
    expect(label.color).toBe('#654321');
    expect(await rows()).toEqual([
      { status: 'done', last_error: null },
      { status: 'superseded', last_error: 'SYNC_SOURCE_ALIAS_AMBIGUOUS' },
      { status: 'superseded', last_error: 'SYNC_SOURCE_ALIAS_AMBIGUOUS' },
    ]);
  } finally {
    await f.close();
  }
});

test('a signed source removal retires the open problem rows of the removed entity', async () => {
  const { f, source, actor, env, config } = await configured();
  try {
    const native = targetId(actor.workspace_id, source.ids.org, 'issues', source.ids.issue);
    expect(
      (await f.request('PATCH', '/api/v1/issues/' + native, { version: 1, title: 'Native edit' }))
        .status,
    ).toBe(200);
    const record = { ...source.data.issues.find((r) => r.id === source.ids.issue) };
    const fetcher = async (_url, options) => {
      const { query } = JSON.parse(options.body);
      if (query.includes('SyncOrganization'))
        return Response.json({ data: { organization: { id: source.ids.org } } });
      if (query.includes('SyncEntity')) return Response.json({ data: { issue: record } });
      if (query.includes('issueUpdate'))
        return Response.json({
          errors: [{ message: 'Rejected', extensions: { code: 'INPUT_ERROR' } }],
        });
      throw Error('Unexpected source operation');
    };
    const job = await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        { kind: 'entity', collection: 'issues', sourceId: source.ids.issue, side: 'source' },
        'rejected-before-removal',
      ),
    );
    expect(
      await reconcileEntityJob(f.db, env, job.id, config.generation, { fetcher }),
    ).toMatchObject({ code: 'SOURCE_QUERY_REJECTED' });

    const raw = Buffer.from(
      JSON.stringify({
        type: 'Issue',
        action: 'remove',
        organizationId: source.ids.org,
        createdAt: '2026-09-30T06:00:00Z',
        webhookTimestamp: Date.now(),
        data: { id: source.ids.issue },
      }),
    );
    const event = verifySourceWebhook(
      new Headers({
        'linear-signature': hmac(env.LINEAR_WEBHOOK_SECRET, raw),
        'linear-delivery': crypto.randomUUID(),
      }),
      raw,
      env,
    );
    const removal = await f.db.transaction((tx) => receiveSourceWebhook(tx, event, env));
    expect(
      await reconcileEntityJob(f.db, env, removal.jobId, config.generation, { fetcher }),
    ).toMatchObject({ status: 'removed' });
    expect(await jobState(f, job.id)).toEqual({
      status: 'superseded',
      last_error: 'SOURCE_QUERY_REJECTED',
    });
  } finally {
    await f.close();
  }
});
