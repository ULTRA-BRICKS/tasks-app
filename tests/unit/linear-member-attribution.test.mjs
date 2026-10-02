import { test, expect } from 'bun:test';
import assert from 'node:assert/strict';
import { configured } from './linear-live-queue.test.mjs';
import { referenceResolver } from '../../packages/server/modules/linear-live/context.mjs';
import { enqueueSyncJob } from '../../packages/server/modules/linear-live/store.mjs';
import { reconcileEntityJob } from '../../packages/server/modules/linear-live/engine.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';

async function matchExistingMember(f, actor) {
  await f.db.transaction((tx) =>
    tx.exec('UPDATE users SET email=? WHERE id=?', ['SOURCE-ONLY@example.test', actor.id]),
  );
}

test('existing workspace member attribution resolves uniquely to an imported Linear person without changing accounts', async () => {
  const { f, actor, source, config } = await configured();
  try {
    await matchExistingMember(f, actor);
    const before = await f.db.transaction((tx) =>
      tx.all('SELECT id,email,name FROM users ORDER BY id'),
    );
    const resolver = await f.db.transaction((tx) =>
      referenceResolver(tx, config, 'initiatives', null, null, { owner_id: actor.id }),
    );
    expect(resolver.reverse('users', actor.id)).toBe(source.ids.user);
    expect(resolver.sameField('description', '- One\n- Two', '* One\n* Two')).toBe(true);
    expect(resolver.sameField('owner_id', crypto.randomUUID(), crypto.randomUUID())).toBe(false);
    expect(resolver.resolve('users', source.ids.user)).toBe(
      targetId(actor.workspace_id, source.ids.org, 'users', source.ids.user),
    );
    expect(
      await f.db.transaction((tx) => tx.all('SELECT id,email,name FROM users ORDER BY id')),
    ).toEqual(before);
    const foreign = { ...config, organizationId: crypto.randomUUID() };
    const excluded = await f.db.transaction((tx) =>
      referenceResolver(tx, foreign, 'initiatives', null, null, { owner_id: actor.id }),
    );
    expect(() => excluded.reverse('users', actor.id)).toThrow();
  } finally {
    await f.close();
  }
});

test('same-person member/source representation does not overwrite native ownership or emit a redundant source edit', async () => {
  const { f, actor, source, config, env } = await configured();
  try {
    await matchExistingMember(f, actor);
    const nid = targetId(actor.workspace_id, source.ids.org, 'initiatives', source.ids.initiative);
    const changed = await f.request('PATCH', '/api/v1/initiatives/' + nid, {
      version: 1,
      owner_id: actor.id,
    });
    expect(changed.status).toBe(200);
    const record = {
      ...source.data.initiatives[0],
      projects: {
        nodes: [{ id: source.ids.project }],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
      owner: { id: source.ids.user, email: 'source-only@example.test' },
    };
    const fetcher = async (_url, options) => {
      const q = JSON.parse(options.body).query;
      if (q.includes('SyncOrganization'))
        return Response.json({ data: { organization: { id: source.ids.org } } });
      if (q.includes('SyncEntity')) return Response.json({ data: { initiative: record } });
      throw Error('No redundant source mutation is allowed');
    };
    for (let pass = 0; pass < 2; pass++) {
      const job = await f.db.transaction((tx) =>
        enqueueSyncJob(
          tx,
          actor.workspace_id,
          {
            kind: 'entity',
            collection: 'initiatives',
            side: 'native',
            sourceId: source.ids.initiative,
            targetId: nid,
          },
          'member-attribution-' + pass,
        ),
      );
      const result = await reconcileEntityJob(f.db, env, job.id, config.generation, { fetcher });
      expect(result.status).toBe('converged');
      const kept = await f.db.transaction((tx) =>
        tx.one(
          'SELECT owner_id,owner_source_id,version FROM initiatives WHERE workspace_id=? AND id=?',
          [actor.workspace_id, nid],
        ),
      );
      expect(kept).toEqual({ owner_id: actor.id, owner_source_id: null, version: 2 });
    }
  } finally {
    await f.close();
  }
});

test('ambiguous imported email matches and nonmember identities cannot pick a source person', async () => {
  const { f, actor, source, config } = await configured();
  try {
    await matchExistingMember(f, actor);
    await f.db.transaction(async (tx) => {
      const person = await tx.one(
        'SELECT * FROM source_people WHERE workspace_id=? AND source_id=?',
        [actor.workspace_id, source.ids.user],
      );
      const mapping = await tx.one(
        'SELECT * FROM linear_source_map WHERE workspace_id=? AND collection=? AND source_id=?',
        [actor.workspace_id, 'users', source.ids.user],
      );
      for (let duplicate = 0; duplicate < 2; duplicate++) {
        const sid = crypto.randomUUID(),
          pid = crypto.randomUUID();
        await tx.exec(
          'INSERT INTO source_people(id,workspace_id,provider,source_id,name,email,avatar_url,created_at) VALUES(?,?,?,?,?,?,?,?)',
          [
            pid,
            actor.workspace_id,
            'linear',
            sid,
            'Same email is not proof of which account',
            person.email,
            null,
            person.created_at,
          ],
        );
        await tx.exec(
          'INSERT INTO linear_source_map(workspace_id,source_workspace_id,collection,source_id,target_id,payload_hash,import_id) VALUES(?,?,?,?,?,?,?)',
          [
            actor.workspace_id,
            source.ids.org,
            'users',
            sid,
            pid,
            mapping.payload_hash,
            mapping.import_id,
          ],
        );
      }
    });
    const resolver = await f.db.transaction((tx) =>
      referenceResolver(
        {
          ...tx,
          all: async (sql, args) => {
            const rows = await tx.all(sql, args);
            if (sql.includes("p.provider='linear'")) expect(rows.length).toBeLessThanOrEqual(2);
            return rows;
          },
        },
        config,
        'initiatives',
        null,
        null,
        { owner_id: actor.id },
      ),
    );
    assert.throws(() => resolver.reverse('users', actor.id));
    const unknown = await f.db.transaction((tx) =>
      referenceResolver(tx, config, 'initiatives', null, null, { owner_id: crypto.randomUUID() }),
    );
    assert.throws(() => unknown.reverse('users', actor.id));
  } finally {
    await f.close();
  }
});
