import { test, expect } from 'bun:test';
import { sourceFixture } from './linear-import-fixture.mjs';
import { configured } from './linear-live-queue.test.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';
import { enqueueSyncJob } from '../../packages/server/modules/linear-live/store.mjs';
import { reconcileEntityJob } from '../../packages/server/modules/linear-live/engine.mjs';
import { contextFor } from '../../packages/server/modules/linear-live/context.mjs';
import { scanRecordIsUnchanged } from '../../packages/server/modules/linear-live/scan-unchanged.mjs';

async function scenario({ ambiguous = false } = {}) {
  const source = sourceFixture();
  source.data.users[0].email = 'OWNER@example.test';
  if (ambiguous) source.data.users.push({ ...source.data.users[0], id: crypto.randomUUID() });
  source.manifest.counts.users = source.data.users.length;
  const c = await configured(source);
  c.nativeId = targetId(c.config.workspaceId, source.ids.org, 'issues', source.ids.issue);
  const before = (await c.f.request('GET', '/api/v1/issues/' + c.nativeId)).data;
  const changed = await c.f.request('PATCH', '/api/v1/issues/' + c.nativeId, {
    version: before.version,
    assignee_id: c.actor.id,
  });
  expect(changed.status).toBe(200);
  c.current = (await c.f.request('GET', '/api/v1/issues/' + c.nativeId)).data;
  c.remote = source.data.issues.find((r) => r.id === source.ids.issue);
  c.sourceMutations = 0;
  c.fetcher = async (_url, options) => {
    const { query } = JSON.parse(options.body);
    if (query.includes('SyncOrganization'))
      return Response.json({ data: { organization: { id: source.ids.org } } });
    if (query.includes('SyncEntity')) return Response.json({ data: { issue: c.remote } });
    c.sourceMutations++;
    throw Error('No source write is needed for equivalent person identities');
  };
  return c;
}
test('a unique mapped source person and existing member compare equally without rewriting stored attribution', async () => {
  const c = await scenario();
  try {
    const q = await c.f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        c.actor.workspace_id,
        {
          kind: 'entity',
          collection: 'issues',
          side: 'native',
          sourceId: c.source.ids.issue,
          targetId: c.nativeId,
        },
        'member-alias',
      ),
    );
    const result = await reconcileEntityJob(c.f.db, c.env, q.id, c.config.generation, {
      fetcher: c.fetcher,
    });
    expect(result.status).toBe('converged');
    const after = (await c.f.request('GET', '/api/v1/issues/' + c.nativeId)).data;
    expect(after.version).toBe(c.current.version);
    expect(after.assignee_id).toBe(c.actor.id);
    expect(after.assignee_source_id).toBeNull();
    expect(c.sourceMutations).toBe(0);
  } finally {
    await c.f.close();
  }
});
test('the native scan recognizes an unchanged member/source-person identity pair without dirtying it', async () => {
  const c = await scenario();
  try {
    expect(
      await c.f.db.transaction((tx) =>
        scanRecordIsUnchanged(tx, c.config, 'issues', c.current, c.source.ids.issue, 'native'),
      ),
    ).toBe(true);
  } finally {
    await c.f.close();
  }
});
test('duplicate source-email identities never create an arbitrary member alias', async () => {
  const c = await scenario({ ambiguous: true });
  try {
    const context = await c.f.db.transaction((tx) => contextFor(tx, c.config, 'issues', c.remote));
    expect(() => context.resolver.reverse('users', c.actor.id)).toThrow();
  } finally {
    await c.f.close();
  }
});

test('a recorded initiative owner conflict clears for the same mapped member without reassigning either system', async () => {
  const source = sourceFixture();
  source.data.users[0].email = 'owner@example.test';
  const c = await configured(source);
  try {
    const { loadNative } = await import('../../packages/server/modules/linear-live/context.mjs');
    const { writeEntityState, readEntityState } =
      await import('../../packages/server/modules/linear-live/store.mjs');
    const id = targetId(c.config.workspaceId, source.ids.org, 'initiatives', source.ids.initiative);
    const personId = targetId(c.config.workspaceId, source.ids.org, 'users', source.ids.user);
    const before = await c.f.db.transaction((tx) => loadNative(tx, c.config, 'initiatives', id));
    const updated = await c.f.request('PATCH', '/api/v1/initiatives/' + id, {
      version: before.version,
      owner_id: c.actor.id,
    });
    expect(updated.status).toBe(200);
    const current = await c.f.db.transaction((tx) => loadNative(tx, c.config, 'initiatives', id));
    await c.f.db.transaction((tx) =>
      writeEntityState(tx, c.actor.workspace_id, 'initiatives', source.ids.initiative, {
        collection: 'initiatives',
        sourceId: source.ids.initiative,
        targetId: id,
        conflicts: { owner_id: { local: c.actor.id, source: personId, baseline: null } },
      }),
    );
    const job = await c.f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        c.actor.workspace_id,
        {
          kind: 'entity',
          collection: 'initiatives',
          sourceId: source.ids.initiative,
          targetId: id,
          side: 'source',
        },
        'same-initiative-owner',
      ),
    );
    const remote = {
      ...source.data.initiatives[0],
      projects: {
        ...source.data.initiatives[0].projects,
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
    let mutations = 0;
    const result = await reconcileEntityJob(c.f.db, c.env, job.id, c.config.generation, {
      fetcher: async (_url, options) => {
        const { query } = JSON.parse(options.body);
        if (query.includes('SyncOrganization'))
          return Response.json({ data: { organization: { id: source.ids.org } } });
        if (query.includes('SyncEntity')) return Response.json({ data: { initiative: remote } });
        mutations++;
        throw Error('No source reassignment needed');
      },
    });
    expect(result.status).toBe('converged');
    expect(mutations).toBe(0);
    const after = await c.f.db.transaction((tx) => loadNative(tx, c.config, 'initiatives', id));
    expect(after.owner_id).toBe(c.actor.id);
    expect(after.owner_source_id).toBeNull();
    expect(after.version).toBe(current.version);
    const state = await c.f.db.transaction((tx) =>
      readEntityState(tx, c.actor.workspace_id, 'initiatives', source.ids.initiative),
    );
    expect(state.conflicts).toEqual({});
  } finally {
    await c.f.close();
  }
});

test('person alias comparison never equates unrelated identifiers or expands to other fields', () => {
  const {
    personFieldComparator,
  } = require('../../packages/server/modules/linear-live/person-aliases.mjs');
  const member = crypto.randomUUID(),
    person = crypto.randomUUID();
  const same = personFieldComparator([{ member_id: member, person_id: person }]);
  for (const field of ['owner_id', 'assignee_id', 'lead_id'])
    expect(same(field, member, person)).toBe(true);
  expect(same('project_id', member, person)).toBe(false);
  expect(same('owner_id', member, crypto.randomUUID())).toBe(false);
  expect(same('owner_id', member, null)).toBe(false);
});

test('person uniqueness does not run correlated workspace scans for each candidate', async () => {
  const c = await scenario();
  try {
    const { sourcePersonAliases } =
      await import('../../packages/server/modules/linear-live/person-aliases.mjs');
    await c.f.db.transaction(async (tx) => {
      let captured;
      const aliases = await sourcePersonAliases(
        {
          all(sql, args) {
            captured = { sql, args };
            return tx.all(sql, args);
          },
        },
        c.config,
        [c.actor.id],
        [],
      );
      expect(aliases).toHaveLength(1);
      const prefix = process.env.TEST_DATABASE_URL
        ? 'EXPLAIN (FORMAT JSON) '
        : 'EXPLAIN QUERY PLAN ';
      const plan = await tx.all(prefix + captured.sql, captured.args);
      expect(JSON.stringify(plan)).not.toMatch(/CORRELATED SCALAR SUBQUERY|SubPlan/);
    });
  } finally {
    await c.f.close();
  }
});

test('person-side lookup uses the same unique scoped identity and cannot borrow another organization', async () => {
  const c = await scenario();
  try {
    const { sourcePersonAliases } =
      await import('../../packages/server/modules/linear-live/person-aliases.mjs');
    const personId = targetId(c.config.workspaceId, c.source.ids.org, 'users', c.source.ids.user);
    await c.f.db.transaction(async (tx) => {
      const byMember = await sourcePersonAliases(tx, c.config, [c.actor.id], []);
      const byPerson = await sourcePersonAliases(tx, c.config, [], [personId]);
      expect(byPerson).toEqual(byMember);
      expect(byPerson).toHaveLength(1);
      expect(
        await sourcePersonAliases(
          tx,
          { ...c.config, organizationId: crypto.randomUUID() },
          [c.actor.id],
          [personId],
        ),
      ).toEqual([]);
      expect(
        await sourcePersonAliases(
          tx,
          { ...c.config, workspaceId: crypto.randomUUID() },
          [c.actor.id],
          [personId],
        ),
      ).toEqual([]);
      expect(
        await sourcePersonAliases(
          {
            all() {
              throw Error('No query for an empty lookup');
            },
          },
          c.config,
          [],
          [],
        ),
      ).toEqual([]);
    });
  } finally {
    await c.f.close();
  }
});

for (const edited of [false, true]) {
  test(`removal preserves content and only reports genuine edits, not person aliases (${edited})`, async () => {
    const c = await scenario();
    try {
      const { hmac } = await import('../../packages/server/core/crypto.mjs');
      const { verifySourceWebhook, receiveSourceWebhook } =
        await import('../../packages/server/modules/linear-live/webhook.mjs');
      const { readEntityState } =
        await import('../../packages/server/modules/linear-live/store.mjs');
      if (edited) {
        const response = await c.f.request('PATCH', '/api/v1/issues/' + c.nativeId, {
          version: c.current.version,
          description: 'Keep this genuine local edit.',
        });
        expect(response.status).toBe(200);
      }
      const before = (await c.f.request('GET', '/api/v1/issues/' + c.nativeId)).data;
      const stamp = '2026-10-21T10:00:00.000Z';
      const raw = Buffer.from(
        JSON.stringify({
          type: 'Issue',
          action: 'remove',
          organizationId: c.source.ids.org,
          createdAt: stamp,
          webhookTimestamp: Date.now(),
          data: { id: c.source.ids.issue },
        }),
      );
      const event = verifySourceWebhook(
        new Headers({
          'linear-signature': hmac(c.env.LINEAR_WEBHOOK_SECRET, raw),
          'linear-delivery': crypto.randomUUID(),
        }),
        raw,
        c.env,
      );
      const receipt = await c.f.db.transaction((tx) => receiveSourceWebhook(tx, event, c.env));
      await reconcileEntityJob(c.f.db, c.env, receipt.jobId, c.config.generation, {
        fetcher: c.fetcher,
      });
      const state = await c.f.db.transaction((tx) =>
        readEntityState(tx, c.config.workspaceId, 'issues', c.source.ids.issue),
      );
      expect(state.removedAt).toBe(stamp);
      expect(Boolean(state.conflicts?.removal)).toBe(edited);
      const after = (await c.f.request('GET', '/api/v1/issues/' + c.nativeId)).data;
      expect(after.assignee_id).toBe(c.actor.id);
      expect(after.description).toBe(before.description);
      expect(after.deleted_at).toBeNull();
      expect(c.sourceMutations).toBe(0);
    } finally {
      await c.f.close();
    }
  });
}
