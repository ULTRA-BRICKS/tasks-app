/** Synthetic HTTP regressions for raw source UUID collisions at import/append boundaries.
 * The shared fixture selects isolated SQLite or coordinator-provided PostgreSQL schemas.
 */
import { test, expect } from 'bun:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { sourceFixture } from './linear-import-fixture.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';
import { assertUnboundCommentIdsAvailable } from '../../packages/server/modules/linear-import/comment-identity.mjs';

async function setup(mode) {
  const f = await fixture();
  const source = sourceFixture();
  const created = await f.request('POST', '/api/v1/imports/linear', { manifest: source.manifest });
  const run = created.data.id;
  for (const [collection, records] of Object.entries(source.data))
    if (records.length)
      expect(
        (await f.request('POST', `/api/v1/imports/linear/${run}/records`, { collection, records }))
          .status,
      ).toBe(200);
  const bulk = `/api/v1/imports/linear/${run}`;
  if (mode === 'append') {
    const plan = await f.request('POST', bulk + '/plan');
    expect(
      (await f.request('POST', bulk + '/apply', { plan_hash: plan.data.plan_hash })).status,
    ).toBe(200);
  }
  const record = {
    ...source.data.comments[0],
    ...(mode === 'append' ? { id: crypto.randomUUID() } : {}),
  };
  const input = { source_workspace_id: source.ids.org, comments: [record] };
  const invoke = (hash) =>
    f.request(
      'POST',
      mode === 'bulk' ? bulk + (hash ? '/apply' : '/plan') : '/api/v1/imports/linear/append',
      mode === 'bulk'
        ? hash
          ? { plan_hash: hash }
          : undefined
        : { ...input, ...(hash ? { plan_hash: hash } : {}) },
    );
  const seed = async () => {
    const issue = await f.create();
    expect(issue.status).toBe(201);
    await f.db.transaction((tx) =>
      tx.exec(
        'INSERT INTO comments(id,workspace_id,issue_id,author_id,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
        [
          record.id,
          f.init.workspace_id,
          issue.data.id,
          f.init.user_id,
          record.body,
          record.createdAt,
          record.updatedAt,
        ],
      ),
    );
  };
  const snapshot = () =>
    f.db.transaction(async (tx) => {
      const result = {};
      for (const table of [
        'comments',
        'issues',
        'teams',
        'labels',
        'source_people',
        'activity',
        'outbox',
        'linear_imports',
        'linear_import_records',
        'linear_source_map',
        'linear_import_files',
      ])
        result[table] = await tx.all(
          `SELECT * FROM ${table} ORDER BY ${table === 'linear_import_records' || table === 'linear_source_map' ? 'collection,source_id' : 'id'}`,
        );
      return result;
    });
  return { f, source, record, input, invoke, seed, snapshot, bulk };
}

for (const mode of ['bulk', 'append']) {
  for (const boundary of ['plan', 'apply'])
    test(`${mode} ${boundary} refuses an unbound raw-source UUID without changing rows or mappings`, async () => {
      const s = await setup(mode);
      try {
        const plan = boundary === 'apply' ? await s.invoke() : null;
        if (plan) expect(plan.status).toBe(200);
        await s.seed();
        const before = await s.snapshot();
        const result = await s.invoke(plan?.data.plan_hash);
        if (result.status === 200) {
          if (boundary === 'plan') expect((await s.invoke(result.data.plan_hash)).status).toBe(200);
          const rows = await s.f.db.transaction((tx) =>
            tx.all('SELECT id FROM comments WHERE workspace_id=? AND id IN (?,?)', [
              s.f.init.workspace_id,
              s.record.id,
              targetId(s.f.init.workspace_id, s.source.ids.org, 'comments', s.record.id),
            ]),
          );
          expect(rows).toHaveLength(1);
        }
        expect(result.status).toBe(409);
        expect(result.data.error.code).toBe('COMMENT_SOURCE_BINDING_REQUIRED');
        expect(result.data.error.message).toContain('no changes');
        expect(await s.snapshot()).toEqual(before);
      } finally {
        await s.f.close();
      }
    });

  test(`${mode} ignores a foreign raw UUID and preserves mapped replay`, async () => {
    const s = await setup(mode);
    try {
      const absent = await s.invoke();
      expect(absent.status).toBe(200);
      await s.seed();
      const foreign = crypto.randomUUID();
      await s.f.db.transaction(async (tx) => {
        await tx.exec('INSERT INTO workspaces(id,name,slug,created_at) VALUES(?,?,?,?)', [
          foreign,
          'Synthetic foreign workspace',
          foreign,
          s.record.createdAt,
        ]);
        await tx.exec('INSERT INTO memberships(workspace_id,user_id,role) VALUES(?,?,?)', [
          foreign,
          s.f.init.user_id,
          'owner',
        ]);
        const comment = await tx.one('SELECT issue_id FROM comments WHERE id=?', [s.record.id]);
        const issue = await tx.one('SELECT * FROM issues WHERE id=?', [comment.issue_id]);
        const team = crypto.randomUUID();
        await tx.exec('INSERT INTO teams(id,workspace_id,key,name) VALUES(?,?,?,?)', [
          team,
          foreign,
          'OTHER',
          'Other',
        ]);
        const status = await tx.one('SELECT * FROM statuses WHERE id=?', [issue.status_id]);
        const statusId = crypto.randomUUID();
        await tx.exec(
          'INSERT INTO statuses(id,workspace_id,team_id,name,category,color,position) VALUES(?,?,?,?,?,?,?)',
          [statusId, foreign, team, status.name, status.category, status.color, status.position],
        );
        const otherIssue = {
          ...issue,
          id: crypto.randomUUID(),
          workspace_id: foreign,
          team_id: team,
          status_id: statusId,
        };
        const keys = Object.keys(otherIssue);
        await tx.exec(
          `INSERT INTO issues(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`,
          Object.values(otherIssue),
        );
        await tx.exec('UPDATE comments SET workspace_id=?,issue_id=? WHERE id=?', [
          foreign,
          otherIssue.id,
          s.record.id,
        ]);
      });
      const present = await s.invoke();
      expect(present).toMatchObject({ status: 200, data: absent.data });
      const foreignBefore = await s.f.db.transaction((tx) =>
        tx.one('SELECT * FROM comments WHERE id=?', [s.record.id]),
      );
      expect((await s.invoke(present.data.plan_hash)).status).toBe(200);
      const beforeReplay = await s.snapshot();
      expect((await s.invoke(present.data.plan_hash)).status).toBe(200);
      expect(await s.snapshot()).toEqual(beforeReplay);
      expect(
        await s.f.db.transaction((tx) =>
          tx.one('SELECT * FROM comments WHERE id=?', [s.record.id]),
        ),
      ).toEqual(foreignBefore);
    } finally {
      await s.f.close();
    }
  });
}

test('bulk fully mapped replay tolerates a raw UUID row without adopting or modifying it', async () => {
  const s = await setup('bulk');
  try {
    const plan = await s.invoke();
    expect((await s.invoke(plan.data.plan_hash)).status).toBe(200);
    await s.seed();
    const manifest = {
      ...s.source.manifest,
      organization: { ...s.source.manifest.organization, name: 'Synthetic replay' },
    };
    const run = (await s.f.request('POST', '/api/v1/imports/linear', { manifest })).data.id;
    for (const [collection, records] of Object.entries(s.source.data))
      if (records.length)
        expect(
          (
            await s.f.request('POST', `/api/v1/imports/linear/${run}/records`, {
              collection,
              records,
            })
          ).status,
        ).toBe(200);
    const before = await s.snapshot();
    const replay = await s.f.request('POST', `/api/v1/imports/linear/${run}/plan`);
    expect(replay.status).toBe(200);
    expect(replay.data.already_applied).toBe(true);
    expect(
      (
        await s.f.request('POST', `/api/v1/imports/linear/${run}/apply`, {
          plan_hash: replay.data.plan_hash,
        })
      ).status,
    ).toBe(200);
    const after = await s.snapshot();
    expect(after.comments).toEqual(before.comments);
    expect(after.linear_source_map).toEqual(before.linear_source_map);
  } finally {
    await s.f.close();
  }
});

test('explicit comment binding resolves append refusal and mapped replay preserves the native row', async () => {
  const s = await setup('append');
  try {
    await s.seed();
    expect((await s.invoke()).status).toBe(409);
    const binding = {
      source_workspace_id: s.source.ids.org,
      bindings: [{ collection: 'comments', record: s.record, target_id: s.record.id }],
    };
    const plan = await s.f.request('POST', '/api/v1/imports/linear/bind', binding);
    expect(plan.status).toBe(200);
    expect(
      (
        await s.f.request('POST', '/api/v1/imports/linear/bind', {
          ...binding,
          plan_hash: plan.data.plan_hash,
        })
      ).status,
    ).toBe(200);
    const before = await s.snapshot();
    const replay = await s.invoke();
    expect(replay.status).toBe(200);
    expect(replay.data.created.comments).toBe(0);
    expect(replay.data.skipped[0].target_id).toBe(s.record.id);
    expect((await s.invoke(replay.data.plan_hash)).status).toBe(200);
    const after = await s.snapshot();
    expect(after.comments).toEqual(before.comments);
    expect(after.linear_source_map).toEqual(before.linear_source_map);
  } finally {
    await s.f.close();
  }
});

for (const mode of ['bulk', 'append'])
  for (const boundary of ['plan', 'apply'])
    test(`${mode} ${boundary} rejects mixed stored UUID casing`, async () => {
      const s = await setup(mode);
      try {
        const plan = boundary === 'apply' ? await s.invoke() : null;
        if (plan) expect(plan.status).toBe(200);
        await s.seed();
        await s.f.db.transaction((tx) =>
          tx.exec('UPDATE comments SET id=? WHERE workspace_id=? AND id=?', [
            s.record.id.toUpperCase(),
            s.f.init.workspace_id,
            s.record.id,
          ]),
        );
        const before = await s.snapshot();
        const result = await s.invoke(plan?.data.plan_hash);
        expect(result.status).toBe(409);
        expect(result.data.error.code).toBe('COMMENT_SOURCE_BINDING_REQUIRED');
        expect(await s.snapshot()).toEqual(before);
      } finally {
        await s.f.close();
      }
    });

test('large UUID inventories use one relational lookup and preserve case-insensitive collisions', async () => {
  const s = await setup('append');
  try {
    const ids = Array.from({ length: 99000 }, () => crypto.randomUUID());
    const queries = [];
    const check = (ids) =>
      s.f.db.transaction((tx) =>
        assertUnboundCommentIdsAvailable(
          {
            ...tx,
            all: async (sql, args) => {
              queries.push(sql);
              return tx.all(sql, args);
            },
          },
          s.f.init.workspace_id,
          ids,
        ),
      );
    await check(ids);
    expect(queries).toHaveLength(1);
    await s.seed();
    ids[ids.length - 1] = s.record.id.toUpperCase();
    queries.length = 0;
    await assert.rejects(check(ids), { code: 'COMMENT_SOURCE_BINDING_REQUIRED' });
    expect(queries).toHaveLength(1);
  } finally {
    await s.f.close();
  }
});

test('canonical UUID collision lookup is indexed for a single append amid large workspace history', async () => {
  const s = await setup('append');
  try {
    const issue = await s.f.create();
    expect(issue.status).toBe(201);
    await s.f.db.transaction(async (tx) => {
      const series =
        tx.dialect === 'postgres'
          ? "SELECT n, 'aaaaaaaa-0000-4000-8000-' || lpad(n::text,12,'0') AS id FROM generate_series(1,20000) AS seq(n)"
          : "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<20000) SELECT n, 'aaaaaaaa-0000-4000-8000-' || printf('%012d',n) AS id FROM seq";
      await tx.exec(
        `INSERT INTO comments(id,workspace_id,issue_id,author_id,body,created_at,updated_at) SELECT id,?,?,?,'Synthetic history',?,? FROM (${series}) AS inventory`,
        [
          s.f.init.workspace_id,
          issue.data.id,
          s.f.init.user_id,
          s.record.createdAt,
          s.record.updatedAt,
        ],
      );
      await tx.exec('ANALYZE comments');
      let query;
      await assertUnboundCommentIdsAvailable(
        {
          ...tx,
          all: async (sql, args) => {
            query = { sql, args };
            return tx.all(sql, args);
          },
        },
        s.f.init.workspace_id,
        [s.record.id.toUpperCase()],
      );
      const plan = await tx.all(
        (tx.dialect === 'postgres' ? 'EXPLAIN ' : 'EXPLAIN QUERY PLAN ') + query.sql,
        query.args,
      );
      expect(JSON.stringify(plan)).toContain('comments_workspace_canonical_id');
    });
  } finally {
    await s.f.close();
  }
});
