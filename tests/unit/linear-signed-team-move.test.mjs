// Exercises signed source moves through the real scan, engine and notice-refresh jobs.
// Isolated imported SQLite fixtures preserve UUID identity and business content across renumbering.
import { test, expect } from 'bun:test';
import assert from 'node:assert/strict';
import { configured } from './linear-live-queue.test.mjs';
import { sourceFixture } from './linear-import-fixture.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';
import {
  createMigrationNotice,
  readMigrationNotice,
  normalizeMigrationNotices,
  mappedNoticeVerifier,
} from '../../packages/server/modules/linear-live/migration-notice.mjs';
import { enqueueSyncJob, configureSync } from '../../packages/server/modules/linear-live/store.mjs';
import { reconcileEntityJob } from '../../packages/server/modules/linear-live/engine.mjs';
import { reconcileScanJob } from '../../packages/server/modules/linear-live/scans.mjs';

async function fixture() {
  const source = sourceFixture(),
    team = crypto.randomUUID(),
    state = crypto.randomUUID();
  source.data.teams.push({ ...source.data.teams[0], id: team, key: 'UB' });
  source.data.workflowStates.push({
    ...source.data.workflowStates[0],
    id: state,
    team: { id: team },
  });
  source.manifest.counts.teams++;
  source.manifest.counts.workflowStates++;
  const c = await configured(source);
  c.env.APP_URL = 'https://tasks.example.test';
  await c.f.db.transaction((tx) =>
    tx.exec(
      "INSERT INTO module_settings(workspace_id,module,enabled,config) VALUES(?,'linear-migration-notices',1,'{}')",
      [c.config.workspaceId],
    ),
  );
  const id = targetId(c.config.workspaceId, source.ids.org, 'issues', source.ids.issue);
  const before = (await c.f.request('GET', '/api/v1/issues/' + id)).data;
  const identity = {
    appOrigin: c.env.APP_URL,
    organizationId: source.ids.org,
    sourceId: source.ids.issue,
    targetId: id,
    code: before.key,
    secret: c.env.LINEAR_WEBHOOK_SECRET,
  };
  const remote = {
    ...source.data.issues.find((r) => r.id === source.ids.issue),
    team: { id: team },
    state: { id: state },
    project: null,
    projectMilestone: null,
    identifier: 'UB-114',
    number: 114,
    updatedAt: '2026-10-16T12:00:00.000Z',
    description: createMigrationNotice(before.description, identity),
  };
  const writes = [];
  const fetcher = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    if (query.includes('SyncOrganization'))
      return Response.json({ data: { organization: { id: source.ids.org } } });
    if (query.includes('MigrationNoticeWrite')) {
      writes.push(variables.input);
      Object.assign(remote, variables.input, { updatedAt: '2026-10-16T13:00:00.000Z' });
      return Response.json({ data: { issueUpdate: { success: true, issue: remote } } });
    }
    if (query.includes('SyncMutation')) {
      writes.push(variables.input);
      Object.assign(remote, variables.input, { updatedAt: '2026-10-16T14:00:00.000Z' });
      return Response.json({ data: { issueUpdate: { success: true, issue: remote } } });
    }
    if (query.includes('SyncEntity')) return Response.json({ data: { issue: remote } });
    if (query.includes('SyncPage'))
      return Response.json({
        data: {
          issues: {
            nodes: [
              {
                id: remote.id,
                identifier: remote.identifier,
                updatedAt: remote.updatedAt,
                archivedAt: remote.archivedAt,
              },
            ],
            pageInfo: { hasNextPage: false },
          },
        },
      });
    if (query.startsWith('mutation')) writes.push(variables.input);
    throw Error('Unexpected source operation: ' + query.slice(0, 60));
  };
  const run = async (side = 'source', scan = false) => {
    const job = await c.f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        c.config.workspaceId,
        {
          kind: scan ? 'scan' : 'entity',
          collection: 'issues',
          side,
          sourceId: remote.id,
          targetId: id,
          pass: crypto.randomUUID(),
          cursor: null,
        },
        crypto.randomUUID(),
      ),
    );
    return (scan ? reconcileScanJob : reconcileEntityJob)(
      c.f.db,
      c.env,
      job.id,
      c.config.generation,
      { fetcher },
    );
  };
  return Object.assign(c, { id, before, identity, remote, writes, fetcher, run, team, state });
}

test('signed source move passes scan and engine, preserves body/comments/status and refreshes link', async () => {
  const c = await fixture();
  try {
    const comments = await c.f.db.transaction((tx) =>
      tx.all('SELECT * FROM comments WHERE issue_id=?', [c.id]),
    );
    const scan = await c.run('source', true);
    expect(scan).toEqual({ status: 'scanned', queued: 1, unchanged: 0 });
    expect(await c.run()).toEqual({ status: 'converged' });
    const after = (await c.f.request('GET', '/api/v1/issues/' + c.id)).data;
    expect(after.key).toBe('UB-114');
    expect(after.id).toBe(c.before.id);
    expect(after.description).toBe(c.before.description);
    expect(after.title).toBe(c.before.title);
    expect(after.status_id).toBe(
      targetId(c.config.workspaceId, c.source.ids.org, 'workflowStates', c.state),
    );
    expect(
      await c.f.db.transaction((tx) => tx.all('SELECT * FROM comments WHERE issue_id=?', [c.id])),
    ).toEqual(comments);
    const jobs = await c.f.db.transaction((tx) =>
      tx.all("SELECT id,payload FROM outbox WHERE status='pending'"),
    );
    const refresh = jobs.find((j) => JSON.parse(j.payload).action === 'migration-notice');
    expect(refresh).toBeTruthy();
    expect(
      (
        await reconcileEntityJob(c.f.db, c.env, refresh.id, c.config.generation, {
          fetcher: c.fetcher,
        })
      ).marked,
    ).toBe(true);
    expect(c.writes).toHaveLength(1);
    expect(Object.keys(c.writes[0])).toEqual(['description']);
    const decoded = readMigrationNotice(c.remote.description, c.identity);
    expect(decoded.notice.code).toBe('UB-114');
    expect(decoded.body).toBe(c.before.description);
    expect(await c.run()).toEqual({ status: 'converged' });
  } finally {
    await c.f.close();
  }
});

for (const invalid of [
  'organization',
  'source',
  'target',
  'signature',
  'number',
  'zero',
  'overflow',
  'identifier',
  'same-team',
  'malformed',
  'unmapped-team',
  'scope',
  'workspace',
  'native',
]) {
  test('signed move rejects ' + invalid + ' without native or source writes', async () => {
    const c = await fixture();
    try {
      if (invalid === 'native') {
        expect(
          (
            await c.f.request('PATCH', '/api/v1/issues/' + c.id, {
              version: c.before.version,
              description: 'Unexported native edit',
            })
          ).status,
        ).toBe(200);
      }
      const nativeBefore = await c.f.db.transaction((tx) =>
        tx.one('SELECT * FROM issues WHERE id=?', [c.id]),
      );
      if (['organization', 'source', 'target'].includes(invalid))
        c.remote.description = createMigrationNotice(c.before.description, {
          ...c.identity,
          [invalid === 'organization' ? 'organizationId' : invalid + 'Id']: crypto.randomUUID(),
        });
      if (invalid === 'signature')
        c.remote.description = createMigrationNotice(c.before.description, {
          ...c.identity,
          secret: 'different-synthetic-secret',
        });
      if (invalid === 'number') c.remote.number = 114.5;
      if (invalid === 'zero') c.remote.number = 0;
      if (invalid === 'overflow') c.remote.number = 2147483647;
      if (invalid === 'same-team') {
        c.remote.team.id = c.source.ids.team;
        c.remote.identifier = 'SRC-114';
      }
      if (invalid === 'malformed')
        c.remote.description = c.remote.description.replace(
          'Managed in Tasks-app',
          'Edited heading',
        );
      if (invalid === 'identifier') c.remote.identifier = 'UB-0114';
      if (invalid === 'unmapped-team') c.remote.team.id = crypto.randomUUID();
      if (invalid === 'scope')
        c.config = await c.f.db.transaction((tx) =>
          configureSync(
            tx,
            c.actor,
            { organizationId: c.source.ids.org, enabled: true, teamIds: [c.source.ids.team] },
            c.env,
          ),
        );
      if (invalid === 'workspace')
        await c.f.db.transaction((tx) =>
          tx.exec(
            "DELETE FROM linear_source_map WHERE workspace_id=? AND collection='issues' AND source_id=?",
            [c.config.workspaceId, c.remote.id],
          ),
        );
      expect(await c.run(invalid === 'native' ? 'native' : 'source')).toEqual({
        status: 'failed',
        code: 'SYNC_MIGRATION_NOTICE_INVALID',
      });
      expect(
        await c.f.db.transaction((tx) => tx.one('SELECT * FROM issues WHERE id=?', [c.id])),
      ).toEqual(nativeBefore);
      expect(c.writes).toEqual([]);
    } finally {
      await c.f.close();
    }
  });
}

test('signed source move cannot resolve its mapping from a different native workspace', async () => {
  const c = await fixture();
  try {
    await assert.rejects(
      normalizeMigrationNotices(
        { issue: c.remote },
        c.env,
        mappedNoticeVerifier(
          c.f.db,
          { ...c.config, workspaceId: crypto.randomUUID() },
          { allowSourceTeamMove: true },
        ),
      ),
      { code: 'SYNC_MIGRATION_NOTICE_INVALID' },
    );
    expect(c.writes).toEqual([]);
  } finally {
    await c.f.close();
  }
});

test('two verified source team moves converge before either signed notice refresh runs', async () => {
  const c = await fixture();
  try {
    const comments = await c.f.db.transaction((tx) =>
      tx.all('SELECT * FROM comments WHERE issue_id=?', [c.id]),
    );
    expect(await c.run()).toEqual({ status: 'converged' });
    expect((await c.f.request('GET', '/api/v1/issues/' + c.id)).data.key).toBe('UB-114');
    const original = c.source.data.issues.find((row) => row.id === c.source.ids.issue);
    Object.assign(c.remote, {
      team: original.team,
      state: original.state,
      number: 1713,
      identifier: c.before.team_key + '-1713',
      updatedAt: '2026-10-16T12:30:00.000Z',
    });
    // The old authenticated notice intentionally still carries the original key.
    expect(readMigrationNotice(c.remote.description, c.identity).notice.code).toBe(c.before.key);
    expect(await c.run()).toEqual({ status: 'converged' });
    const after = (await c.f.request('GET', '/api/v1/issues/' + c.id)).data;
    expect(after.key).toBe(c.remote.identifier);
    expect(after.description).toBe(c.before.description);
    expect(
      await c.f.db.transaction((tx) => tx.all('SELECT * FROM comments WHERE issue_id=?', [c.id])),
    ).toEqual(comments);
    const jobs = await c.f.db.transaction((tx) =>
      tx.all("SELECT id,payload FROM outbox WHERE status='pending'"),
    );
    const refresh = jobs.find((job) => JSON.parse(job.payload).action === 'migration-notice');
    expect(refresh).toBeTruthy();
    expect(
      (
        await reconcileEntityJob(c.f.db, c.env, refresh.id, c.config.generation, {
          fetcher: c.fetcher,
        })
      ).marked,
    ).toBe(true);
    expect(readMigrationNotice(c.remote.description, c.identity).notice.code).toBe(
      c.remote.identifier,
    );
    expect(await c.run()).toEqual({ status: 'converged' });
    expect(c.writes).toHaveLength(1);
  } finally {
    await c.f.close();
  }
});

test('ordinary signed reads do not query destination teams; move reads load only candidate source teams', async () => {
  const c = await fixture();
  try {
    const queries = [];
    const db = {
      transaction: (fn, options) =>
        c.f.db.transaction(
          (tx) =>
            fn({
              ...tx,
              all: async (sql, args) => {
                queries.push({ sql, args });
                return tx.all(sql, args);
              },
            }),
          options,
        ),
    };
    const verify = mappedNoticeVerifier(db, c.config, { allowSourceTeamMove: true });
    await normalizeMigrationNotices(
      { issue: { ...c.remote, identifier: c.before.key } },
      c.env,
      verify,
    );
    expect(queries.filter((q) => q.sql.includes('JOIN teams'))).toHaveLength(0);
    queries.length = 0;
    await normalizeMigrationNotices({ issue: c.remote }, c.env, verify);
    const teamQuery = queries.filter((q) => q.sql.includes('JOIN teams'));
    expect(teamQuery).toHaveLength(1);
    expect(teamQuery[0].sql).toContain('m.source_id IN');
    expect(teamQuery[0].args).toEqual([c.config.workspaceId, c.config.organizationId, c.team]);
  } finally {
    await c.f.close();
  }
});

for (const field of ['title', 'description'])
  test(`source-side team move defers an unexported native ${field} until strict outbound verification succeeds`, async () => {
    const c = await fixture();
    try {
      const value = 'Unexported native ' + field;
      expect(
        (
          await c.f.request('PATCH', '/api/v1/issues/' + c.id, {
            version: c.before.version,
            [field]: value,
          })
        ).status,
      ).toBe(200);
      const outcome = await c.run('source');
      expect(c.writes).toHaveLength(0);
      expect(outcome).toEqual({ status: 'deferred-source' });
      const native = (await c.f.request('GET', '/api/v1/issues/' + c.id)).data;
      expect(native.key).toBe('UB-114');
      expect(native[field]).toBe(value);
      const jobs = await c.f.db.transaction((tx) =>
        tx.all("SELECT id,payload FROM outbox WHERE status='pending'"),
      );
      const refresh = jobs.find((job) => JSON.parse(job.payload).action === 'migration-notice');
      const followup = jobs.find((job) => JSON.parse(job.payload).afterSourceMove === true);
      expect(refresh).toBeTruthy();
      expect(followup).toBeTruthy();
      expect(
        (
          await reconcileEntityJob(c.f.db, c.env, refresh.id, c.config.generation, {
            fetcher: c.fetcher,
          })
        ).marked,
      ).toBe(true);
      expect(
        await reconcileEntityJob(c.f.db, c.env, followup.id, c.config.generation, {
          fetcher: c.fetcher,
        }),
      ).toEqual({ status: 'converged' });
      expect(c.writes).toHaveLength(2);
      expect(readMigrationNotice(c.remote.description, c.identity).notice.code).toBe('UB-114');
      if (field === 'description')
        expect(readMigrationNotice(c.remote.description, c.identity).body).toBe(value);
      else expect(c.remote.title).toBe(value);
      expect((await c.f.request('GET', '/api/v1/issues/' + c.id)).data[field]).toBe(value);
    } finally {
      await c.f.close();
    }
  });

for (const independentEdit of [false, true])
  test(`a title conflict does not block signed move notice repair or retained native edits: ${independentEdit}`, async () => {
    const c = await fixture();
    try {
      const edit = {
        version: c.before.version,
        title: 'Local conflicting title',
        ...(independentEdit ? { description: 'Independent native description' } : {}),
      };
      expect((await c.f.request('PATCH', '/api/v1/issues/' + c.id, edit)).status).toBe(200);
      c.remote.title = 'Source conflicting title';
      expect(await c.run('source')).toEqual({ status: 'conflict' });
      expect(c.writes).toHaveLength(0);
      const jobs = await c.f.db.transaction((tx) =>
        tx.all("SELECT id,payload FROM outbox WHERE status='pending'"),
      );
      const refresh = jobs.find((job) => JSON.parse(job.payload).action === 'migration-notice');
      expect(refresh).toBeTruthy();
      expect(
        (
          await reconcileEntityJob(c.f.db, c.env, refresh.id, c.config.generation, {
            fetcher: c.fetcher,
          })
        ).marked,
      ).toBe(true);
      expect(readMigrationNotice(c.remote.description, c.identity).notice.code).toBe('UB-114');
      if (independentEdit) {
        const followup = jobs.find((job) => JSON.parse(job.payload).afterSourceMove === true);
        expect(followup).toBeTruthy();
        expect(
          await reconcileEntityJob(c.f.db, c.env, followup.id, c.config.generation, {
            fetcher: c.fetcher,
          }),
        ).toEqual({ status: 'conflict' });
        expect(readMigrationNotice(c.remote.description, c.identity).body).toBe(edit.description);
      }
      const native = (await c.f.request('GET', '/api/v1/issues/' + c.id)).data;
      expect(native.key).toBe('UB-114');
      expect(native.title).toBe(edit.title);
      expect(c.remote.title).toBe('Source conflicting title');
      expect(c.writes).toHaveLength(independentEdit ? 2 : 1);
    } finally {
      await c.f.close();
    }
  });
