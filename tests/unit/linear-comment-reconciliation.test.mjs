/** Synthetic identity regressions exercise real import, storage and explicit reconciliation. */
import { test, expect } from 'bun:test';
import assert from 'node:assert/strict';
import { configured } from './linear-live-queue.test.mjs';
import { migrate } from '../../packages/db/index.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';
import { reconcileLinearComments } from '../../packages/server/modules/linear-import/reconcile-comments.mjs';

export async function duplicated() {
  const setup = await configured();
  const { f, source, actor } = setup;
  const canonicalId = targetId(actor.workspace_id, source.ids.org, 'comments', source.ids.comment);
  const canonical = await f.db.transaction((tx) =>
    tx.one('SELECT * FROM comments WHERE id=?', [canonicalId]),
  );
  const legacy = { ...canonical, id: source.ids.comment, version: 3 };
  await f.db.transaction(async (tx) => {
    const keys = Object.keys(legacy);
    await tx.exec(
      `INSERT INTO comments(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`,
      Object.values(legacy),
    );
    await tx.exec(
      'INSERT INTO activity(id,workspace_id,issue_id,actor_id,action,data,created_at) VALUES(?,?,?,?,?,?,?)',
      [
        crypto.randomUUID(),
        actor.workspace_id,
        canonical.issue_id,
        actor.id,
        'commented',
        JSON.stringify({ comment_id: legacy.id }),
        legacy.created_at,
      ],
    );
  });
  const input = { source_workspace_id: source.ids.org, source_ids: [source.ids.comment] };
  const run = (extra = {}, who = actor) =>
    f.db.transaction((tx) => reconcileLinearComments(tx, who, { ...input, ...extra }));
  return { ...setup, canonical, legacy, input, run };
}

test('provenance-linked repair defaults to dry-run, archives exact versions and references, and retries safely', async () => {
  const { f, run, canonical, legacy, source } = await duplicated();
  try {
    const plan = await run();
    expect(plan.applied).toBe(false);
    expect(plan.pairs).toEqual([
      { source_id: source.ids.comment, canonical_id: canonical.id, legacy_id: legacy.id },
    ]);
    expect(await f.db.transaction((tx) => tx.all('SELECT * FROM comments'))).toHaveLength(2);
    const applied = await run({ plan_hash: plan.plan_hash });
    expect(applied.applied).toBe(true);
    expect(applied.before_count).toBe(2);
    expect(applied.after_count).toBe(1);
    expect(applied.archived[0].legacy).toEqual(legacy);
    expect(applied.archived[0].canonical).toEqual(canonical);
    expect(applied.archived[0].references.activity[0].data).toContain(legacy.id);
    expect(
      await f.db.transaction((tx) => tx.one('SELECT * FROM comments WHERE id=?', [canonical.id])),
    ).toEqual(canonical);
    expect((await run({ plan_hash: plan.plan_hash })).unchanged).toBe(true);
    const receipt = await f.db.transaction((tx) =>
      tx.one('SELECT result FROM linear_imports WHERE id=?', [applied.id]),
    );
    expect(JSON.parse(receipt.result).archived[0].legacy).toEqual(legacy);
  } finally {
    await f.close();
  }
});

for (const [field, value, reason] of [
  ['body', 'Different synthetic content', 'content-mismatch'],
  ['created_at', '2024-01-03T03:04:05.006Z', 'creation-time-mismatch'],
  ['author_source_id', null, 'author-mismatch'],
])
  test(`preserves and reports ${reason} instead of trusting same body or UUID`, async () => {
    const { f, run, legacy } = await duplicated();
    try {
      await f.db.transaction((tx) =>
        tx.exec(`UPDATE comments SET ${field}=? WHERE id=?`, [value, legacy.id]),
      );
      const plan = await run();
      expect(plan.pairs).toHaveLength(0);
      expect(plan.ambiguous[0].reason).toBe(reason);
      expect(await f.db.transaction((tx) => tx.all('SELECT * FROM comments'))).toHaveLength(2);
      await assert.rejects(run({ plan_hash: plan.plan_hash }), {
        code: 'NO_PROVEN_PAIRS',
      });
    } finally {
      await f.close();
    }
  });

test('same body, author and time with a distinct native UUID is a legitimate repeat', async () => {
  const { f, run, legacy } = await duplicated();
  try {
    const repeatedId = crypto.randomUUID();
    await f.db.transaction((tx) =>
      tx.exec('UPDATE comments SET id=? WHERE id=?', [repeatedId, legacy.id]),
    );
    const plan = await run();
    expect(plan.pairs).toHaveLength(0);
    expect(plan.after_count).toBe(2);
  } finally {
    await f.close();
  }
});

test('stale evidence, unauthorized callers and native export jobs fail closed', async () => {
  const { f, run, legacy, actor } = await duplicated();
  try {
    const plan = await run();
    await f.db.transaction((tx) =>
      tx.exec('UPDATE comments SET version=version+1 WHERE id=?', [legacy.id]),
    );
    await assert.rejects(run({ plan_hash: plan.plan_hash }), {
      code: 'PLAN_CHANGED',
    });
    await assert.rejects(run({}, { ...actor, role: 'member' }), {
      code: 'FORBIDDEN',
    });
    const { enqueueSyncJob } = await import('../../packages/server/modules/linear-live/store.mjs');
    await f.db.transaction((tx) =>
      enqueueSyncJob(
        tx,
        actor.workspace_id,
        {
          kind: 'entity',
          collection: 'comments',
          side: 'native',
          sourceId: legacy.id,
          targetId: legacy.id,
        },
        'legacy-export',
      ),
    );
    expect((await run()).ambiguous[0].reason).toBe('pending-native-job');
  } finally {
    await f.close();
  }
});

test('transaction failure restores legacy rows and removes the partial receipt', async () => {
  const { f, run, legacy } = await duplicated();
  try {
    const plan = await run();
    await f.db.transaction((tx) =>
      tx.script(
        tx.dialect === 'postgres'
          ? `CREATE FUNCTION reject_repair() RETURNS trigger LANGUAGE plpgsql AS $$
              BEGIN
                IF NEW.data LIKE '%commentIdentityReconciled%' THEN
                  RAISE EXCEPTION 'synthetic audit failure';
                END IF;
                RETURN NEW;
              END $$;
              CREATE TRIGGER reject_repair BEFORE INSERT ON activity FOR EACH ROW EXECUTE FUNCTION reject_repair();`
          : "CREATE TRIGGER reject_repair BEFORE INSERT ON activity WHEN NEW.data LIKE '%commentIdentityReconciled%' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END",
      ),
    );
    await assert.rejects(run({ plan_hash: plan.plan_hash }), /synthetic audit failure/);
    expect(
      await f.db.transaction((tx) => tx.one('SELECT * FROM comments WHERE id=?', [legacy.id])),
    ).toEqual(legacy);
    expect(
      await f.db.transaction((tx) => tx.one('SELECT id FROM linear_imports WHERE id=?', [plan.id])),
    ).toBeNull();
  } finally {
    await f.close();
  }
});

test('cross-workspace legacy IDs are indistinguishable from missing IDs and never merged', async () => {
  const { f, run, legacy, actor } = await duplicated();
  try {
    const otherWorkspace = crypto.randomUUID();
    await f.db.transaction(async (tx) => {
      await tx.exec('INSERT INTO workspaces(id,name,slug,created_at) VALUES(?,?,?,?)', [
        otherWorkspace,
        'Other synthetic workspace',
        otherWorkspace,
        legacy.created_at,
      ]);
      await tx.exec('INSERT INTO memberships(workspace_id,user_id,role) VALUES(?,?,?)', [
        otherWorkspace,
        actor.id,
        'owner',
      ]);
      // A second real issue is required by the composite workspace foreign key.
      const original = await tx.one('SELECT * FROM issues WHERE id=?', [legacy.issue_id]);
      const team = await tx.one('SELECT * FROM teams WHERE id=?', [original.team_id]);
      const status = await tx.one('SELECT * FROM statuses WHERE id=?', [original.status_id]);
      const teamId = crypto.randomUUID(),
        statusId = crypto.randomUUID(),
        issueId = crypto.randomUUID();
      await tx.exec('INSERT INTO teams(id,workspace_id,key,name) VALUES(?,?,?,?)', [
        teamId,
        otherWorkspace,
        'OTHER',
        team.name,
      ]);
      await tx.exec(
        'INSERT INTO statuses(id,workspace_id,team_id,name,category,color,position) VALUES(?,?,?,?,?,?,?)',
        [
          statusId,
          otherWorkspace,
          teamId,
          status.name,
          status.category,
          status.color,
          status.position,
        ],
      );
      await tx.exec(
        'INSERT INTO issues(id,workspace_id,team_id,number,key,title,status_id,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        [
          issueId,
          otherWorkspace,
          teamId,
          1,
          'OTHER-1',
          'Synthetic isolation',
          statusId,
          actor.id,
          legacy.created_at,
          legacy.updated_at,
        ],
      );
      await tx.exec('UPDATE comments SET workspace_id=?,issue_id=? WHERE id=?', [
        otherWorkspace,
        issueId,
        legacy.id,
      ]);
    });
    const plan = await run();
    expect(plan.pairs).toHaveLength(0);
    expect(
      (
        await f.db.transaction((tx) =>
          tx.one('SELECT workspace_id FROM comments WHERE id=?', [legacy.id]),
        )
      ).workspace_id,
    ).toBe(otherWorkspace);
    // Only the synthetic fixture owner removes this foreign record. The actor's
    // reconciliation response must not reveal whether it existed at all.
    await f.db.transaction((tx) =>
      tx.exec('DELETE FROM comments WHERE workspace_id=? AND id=?', [otherWorkspace, legacy.id]),
    );
    const absent = await run();
    expect(plan).toEqual(absent);
    expect(plan.ambiguous).toEqual([]);
  } finally {
    await f.close();
  }
});

test('import and signed create/update/removal replays retain canonical identity after repair', async () => {
  const { f, source, actor, env, config, canonical, run } = await duplicated();
  try {
    const plan = await run();
    await run({ plan_hash: plan.plan_hash });
    const append = { source_workspace_id: source.ids.org, comments: source.data.comments };
    const preview = await f.request('POST', '/api/v1/imports/linear/append', append);
    expect(preview.data.created.comments).toBe(0);
    expect(preview.data.skipped[0].target_id).toBe(canonical.id);
    const apply = await f.request('POST', '/api/v1/imports/linear/append', {
      ...append,
      plan_hash: preview.data.plan_hash,
    });
    expect(apply.status).toBe(200);
    expect(
      (
        await f.request('POST', '/api/v1/imports/linear/append', {
          ...append,
          plan_hash: preview.data.plan_hash,
        })
      ).data.unchanged,
    ).toBe(true);
    const { hmac } = await import('../../packages/server/core/crypto.mjs');
    const { verifySourceWebhook, receiveSourceWebhook } =
      await import('../../packages/server/modules/linear-live/webhook.mjs');
    const { reconcileEntityJob } =
      await import('../../packages/server/modules/linear-live/engine.mjs');
    let remote = source.data.comments[0];
    for (const action of ['create', 'update', 'remove']) {
      if (action === 'update')
        remote = {
          ...remote,
          body: 'Synthetic source edit',
          updatedAt: '2026-10-01T00:00:00.000Z',
        };
      const payload = {
        type: 'Comment',
        action,
        organizationId: source.ids.org,
        data: { id: remote.id },
        createdAt: action === 'remove' ? '2026-10-02T00:00:00.000Z' : remote.updatedAt,
        webhookTimestamp: Date.now(),
      };
      const raw = Buffer.from(JSON.stringify(payload));
      const event = verifySourceWebhook(
        new Headers({
          'linear-signature': hmac(env.LINEAR_WEBHOOK_SECRET, raw),
          'linear-delivery': crypto.randomUUID(),
        }),
        raw,
        env,
      );
      const job = await f.db.transaction((tx) => receiveSourceWebhook(tx, event, env));
      expect((await f.db.transaction((tx) => receiveSourceWebhook(tx, event, env))).duplicate).toBe(
        true,
      );
      const result = await reconcileEntityJob(f.db, env, job.jobId, config.generation, {
        fetcher: async (_url, options) => {
          const query = JSON.parse(options.body).query;
          if (query.includes('SyncOrganization'))
            return Response.json({ data: { organization: { id: source.ids.org } } });
          if (query.includes('comment(')) return Response.json({ data: { comment: remote } });
          throw Error('Unexpected source write or query');
        },
      });
      expect(result.status).toBe(action === 'remove' ? 'removed' : 'converged');
      const rows = await f.db.transaction((tx) =>
        tx.all('SELECT * FROM comments WHERE workspace_id=?', [actor.workspace_id]),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(canonical.id);
      expect(rows[0].body).toBe(remote.body);
      const detail = (await f.request('GET', '/api/v1/issues/' + canonical.issue_id)).data;
      expect(detail.comments.map((row) => row.id)).toEqual([canonical.id]);
      if (action === 'remove')
        expect(detail.comments[0].source_sync.removed_at).toBe('2026-10-02T00:00:00.000Z');
    }
  } finally {
    await f.close();
  }
});

for (const mode of ['missing-map', 'wrong-issue', 'conflicting-map'])
  test(`preserves ambiguous provenance: ${mode}`, async () => {
    const { f, source, actor, legacy, canonical, run } = await duplicated();
    try {
      await f.db.transaction(async (tx) => {
        if (mode === 'missing-map')
          await tx.exec(
            "DELETE FROM linear_source_map WHERE workspace_id=? AND collection='comments'",
            [actor.workspace_id],
          );
        if (mode === 'wrong-issue')
          await tx.exec('UPDATE comments SET issue_id=? WHERE id=?', [
            targetId(actor.workspace_id, source.ids.org, 'issues', source.ids.child),
            legacy.id,
          ]);
        if (mode === 'conflicting-map') {
          const map = await tx.one(
            "SELECT * FROM linear_source_map WHERE workspace_id=? AND collection='comments'",
            [actor.workspace_id],
          );
          await tx.exec(
            "INSERT INTO linear_source_map(workspace_id,source_workspace_id,collection,source_id,target_id,payload_hash,import_id) VALUES(?,?,'comments',?,?,?,?)",
            [
              actor.workspace_id,
              source.ids.org,
              crypto.randomUUID(),
              canonical.id,
              map.payload_hash,
              map.import_id,
            ],
          );
        }
      });
      const plan = await run();
      expect(plan.pairs).toHaveLength(0);
      expect(plan.ambiguous[0].reason).toBe(
        {
          'missing-map': 'missing-source-binding',
          'wrong-issue': 'issue-or-provenance-mismatch',
          'conflicting-map': 'conflicting-source-binding',
        }[mode],
      );
      expect(plan.before_count).toBe(2);
      expect(plan.after_count).toBe(2);
    } finally {
      await f.close();
    }
  });

async function appendedDuplicates(count = 1, timestamps = {}) {
  const setup = await configured();
  const { f, source, actor } = setup;
  const comments = Array.from({ length: count }, () => ({
    ...source.data.comments[0],
    ...timestamps,
    id: crypto.randomUUID(),
    issue: source.ids.issue,
  }));
  for (const row of comments) delete row.issueId;
  const input = { source_workspace_id: source.ids.org, comments };
  const preview = await f.request('POST', '/api/v1/imports/linear/append', input);
  expect(preview.status).toBe(200);
  expect(
    (
      await f.request('POST', '/api/v1/imports/linear/append', {
        ...input,
        plan_hash: preview.data.plan_hash,
      })
    ).status,
  ).toBe(200);
  await f.db.transaction(async (tx) => {
    for (const row of comments) {
      const current = await tx.one('SELECT * FROM comments WHERE id=?', [
        targetId(actor.workspace_id, source.ids.org, 'comments', row.id),
      ]);
      const legacy = { ...current, id: row.id };
      const keys = Object.keys(legacy);
      await tx.exec(
        `INSERT INTO comments(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`,
        Object.values(legacy),
      );
    }
  });
  return {
    ...setup,
    comments,
    input: { source_workspace_id: source.ids.org, source_ids: comments.map((row) => row.id) },
  };
}

test('final review: actual append string issue provenance proves a duplicate', async () => {
  const { f, actor, input } = await appendedDuplicates();
  try {
    const preview = await f.db.transaction((tx) => reconcileLinearComments(tx, actor, input));
    expect(preview.ambiguous).toEqual([]);
    expect(preview.pairs).toHaveLength(1);
    const applied = await f.db.transaction((tx) =>
      reconcileLinearComments(tx, actor, { ...input, plan_hash: preview.plan_hash }),
    );
    expect(JSON.parse(applied.archived[0].mapping.payload).issue).toBeDefined();
    expect(applied.archived[0].legacy.id).toBe(input.source_ids[0]);
  } finally {
    await f.close();
  }
});

for (const status of [
  'pending',
  'processing',
  'failed',
  'blocked',
  'done',
  'completed',
  'superseded',
])
  test(`final review: native outbox ${status} preserves retry safety and historical references`, async () => {
    const { f, run, legacy, actor } = await duplicated();
    try {
      const { enqueueSyncJob } =
        await import('../../packages/server/modules/linear-live/store.mjs');
      await f.db.transaction(async (tx) => {
        await enqueueSyncJob(
          tx,
          actor.workspace_id,
          {
            kind: 'entity',
            collection: 'comments',
            side: 'native',
            sourceId: legacy.id,
            targetId: legacy.id,
          },
          'review-retry',
        );
        await tx.exec('UPDATE outbox SET status=? WHERE workspace_id=?', [
          status,
          actor.workspace_id,
        ]);
      });
      const snapshot = () =>
        f.db.transaction(async (tx) => ({
          comments: await tx.all('SELECT * FROM comments ORDER BY id'),
          outbox: await tx.all('SELECT * FROM outbox ORDER BY id'),
        }));
      const before = await snapshot();
      const preview = await run();
      if (['pending', 'processing', 'failed', 'blocked'].includes(status)) {
        expect(preview.pairs).toHaveLength(0);
        expect(preview.ambiguous[0].reason).toBe('pending-native-job');
        await assert.rejects(run({ plan_hash: preview.plan_hash }), { code: 'NO_PROVEN_PAIRS' });
        expect(await snapshot()).toEqual(before);
      } else {
        expect(preview.pairs).toHaveLength(1);
        const applied = await run({ plan_hash: preview.plan_hash });
        expect(applied.archived[0].references.outbox).toEqual(before.outbox);
        expect((await snapshot()).outbox).toEqual(before.outbox);
      }
    } finally {
      await f.close();
    }
  });

test('final review: fifty candidates scan sparse history in candidate-independent pages with exact substring references', async () => {
  const { f, actor, input, comments } = await appendedDuplicates(50);
  try {
    await f.db.transaction(async (tx) => {
      const issue = await tx.one('SELECT issue_id FROM comments WHERE id=?', [comments[0].id]);
      for (let i = 0; i < 2100; i++) {
        const data = JSON.stringify({
          note:
            i % 700 === 0 || i === 1023
              ? 'prefix' + comments[0].id + comments[49].id + comments[0].id + 'suffix'
              : i === 1024
                ? comments[0].id.toUpperCase()
                : 'sparse unrelated history',
        });
        await tx.exec(
          'INSERT INTO activity(id,workspace_id,issue_id,actor_id,action,data,created_at) VALUES(?,?,?,?,?,?,?)',
          [
            '!history-' + String(i).padStart(5, '0'),
            actor.workspace_id,
            issue.issue_id,
            actor.id,
            'commented',
            tx.dialect === 'sqlite' && i === 1023 ? data + '\0' + comments[1].id : data,
            '2024-01-01T00:00:00.000Z',
          ],
        );
        await tx.exec(
          'INSERT INTO outbox(id,workspace_id,provider,event,payload,status,next_attempt_at,created_at) VALUES(?,?,?,?,?,?,?,?)',
          [
            '!history-' + String(i).padStart(5, '0'),
            actor.workspace_id,
            'linear',
            'entity',
            data,
            'completed',
            '2024-01-01',
            '2024-01-01',
          ],
        );
      }
    });
    const queries = [];
    const reverseMappings = [];
    const preview = await f.db.transaction((tx) =>
      reconcileLinearComments(
        {
          ...tx,
          all: async (sql, params) => {
            queries.push(sql);
            if (/SELECT \* FROM linear_source_map WHERE/.test(sql)) reverseMappings.push(sql);
            return tx.all(sql, params);
          },
          one: async (sql, params) => {
            queries.push(sql);
            return tx.one(sql, params);
          },
        },
        actor,
        input,
      ),
    );
    expect(queries).toHaveLength(18);
    expect(reverseMappings).toHaveLength(1);
    expect(reverseMappings[0]).toContain('workspace_id=?');
    expect(queries.filter((sql) => /FROM activity /.test(sql))).toHaveLength(5);
    expect(queries.filter((sql) => /FROM outbox /.test(sql))).toHaveLength(5);
    expect(queries.some((sql) => /LIKE/.test(sql))).toBe(false);
    expect(preview.pairs).toHaveLength(50);
    const applied = await f.db.transaction((tx) =>
      reconcileLinearComments(tx, actor, { ...input, plan_hash: preview.plan_hash }),
    );
    for (const item of applied.archived) {
      for (const [table, field] of [
        ['activity', 'data'],
        ['outbox', 'payload'],
      ]) {
        const expected = await f.db.transaction((tx) =>
          tx.all(`SELECT * FROM ${table} WHERE workspace_id=? AND ${field} LIKE ? ORDER BY id`, [
            actor.workspace_id,
            '%' + item.legacy.id + '%',
          ]),
        );
        expect(item.references[table]).toEqual(
          expected.filter(
            (row) =>
              row.action !== 'linear_imported_change' ||
              !row.data.includes('commentIdentityReconciled'),
          ),
        );
      }
    }
  } finally {
    await f.close();
  }
});

for (const table of ['activity', 'outbox'])
  test(`final review: oversized sparse ${table} row refuses instead of omitting references`, async () => {
    const { f, actor, run, legacy } = await duplicated();
    try {
      const before = await f.db.transaction((tx) => tx.all('SELECT * FROM comments ORDER BY id'));
      await f.db.transaction((tx) =>
        tx.exec(
          table === 'activity'
            ? 'INSERT INTO activity(id,workspace_id,issue_id,actor_id,action,data,created_at) VALUES(?,?,?,?,?,?,?)'
            : 'INSERT INTO outbox(id,workspace_id,provider,event,payload,status,next_attempt_at,created_at) VALUES(?,?,?,?,?,?,?,?)',
          table === 'activity'
            ? [
                crypto.randomUUID(),
                actor.workspace_id,
                legacy.issue_id,
                actor.id,
                'commented',
                JSON.stringify({ note: 'x'.repeat(8000001) }),
                legacy.created_at,
              ]
            : ['zz-oversize', actor.workspace_id, 'x', 'x', 'x'.repeat(8000001), 'done', 'x', 'x'],
        ),
      );
      await assert.rejects(run(), { code: 'REFERENCE_SCAN_BUDGET_EXCEEDED' });
      expect(await f.db.transaction((tx) => tx.all('SELECT * FROM comments ORDER BY id'))).toEqual(
        before,
      );
    } finally {
      await f.close();
    }
  });

for (const table of ['activity', 'outbox'])
  test(`final review: ${table} per-candidate reference cap refuses without truncation`, async () => {
    const { f, actor, run, legacy } = await duplicated();
    try {
      await f.db.transaction(async (tx) => {
        for (let i = 0; i < 1001; i++) {
          const payload = JSON.stringify({ comment_id: legacy.id });
          if (table === 'activity')
            await tx.exec(
              'INSERT INTO activity(id,workspace_id,issue_id,actor_id,action,data,created_at) VALUES(?,?,?,?,?,?,?)',
              [
                crypto.randomUUID(),
                actor.workspace_id,
                legacy.issue_id,
                actor.id,
                'commented',
                payload,
                legacy.created_at,
              ],
            );
          else
            await tx.exec(
              'INSERT INTO outbox(id,workspace_id,provider,event,payload,status,next_attempt_at,created_at) VALUES(?,?,?,?,?,?,?,?)',
              [
                crypto.randomUUID(),
                actor.workspace_id,
                'linear',
                'entity',
                payload,
                'done',
                legacy.created_at,
                legacy.created_at,
              ],
            );
        }
      });
      const preview = await run();
      expect(preview.ambiguous[0].reason).toBe('archive-budget-exceeded');
      expect(preview.pairs).toEqual([]);
      await assert.rejects(run({ plan_hash: preview.plan_hash }), { code: 'NO_PROVEN_PAIRS' });
      expect(await f.db.transaction((tx) => tx.all('SELECT * FROM comments'))).toHaveLength(2);
    } finally {
      await f.close();
    }
  });

test('final review: changed historical reference invalidates the plan hash', async () => {
  const { f, run, legacy } = await duplicated();
  try {
    const preview = await run();
    await f.db.transaction((tx) =>
      tx.exec('UPDATE activity SET data=? WHERE data LIKE ?', [
        JSON.stringify({ comment_id: legacy.id, changed: true }),
        '%' + legacy.id + '%',
      ]),
    );
    await assert.rejects(run({ plan_hash: preview.plan_hash }), { code: 'PLAN_CHANGED' });
    expect(await f.db.transaction((tx) => tx.all('SELECT * FROM comments'))).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test.skipIf(Boolean(process.env.TEST_DATABASE_URL))(
  'final review: SQLite substring references retain LIKE NUL termination',
  async () => {
    const { f, actor, run, legacy } = await duplicated();
    try {
      expect(f.db.dialect).toBe('sqlite');
      await f.db.transaction((tx) =>
        tx.exec(
          'INSERT INTO activity(id,workspace_id,issue_id,actor_id,action,data,created_at) VALUES(?,?,?,?,?,?,?)',
          [
            crypto.randomUUID(),
            actor.workspace_id,
            legacy.issue_id,
            actor.id,
            'commented',
            'prefix' + String.fromCharCode(0) + legacy.id,
            legacy.created_at,
          ],
        ),
      );
      const expected = await f.db.transaction((tx) =>
        tx.all('SELECT * FROM activity WHERE workspace_id=? AND data LIKE ? ORDER BY id', [
          actor.workspace_id,
          '%' + legacy.id + '%',
        ]),
      );
      const preview = await run();
      const applied = await run({ plan_hash: preview.plan_hash });
      expect(applied.archived[0].references.activity).toEqual(expected);
    } finally {
      await f.close();
    }
  },
);

for (const [canonicalTime, legacyTime, matches] of [
  ['2024-01-02T03:04:05.006100Z', '2024-01-02T03:04:05.006900Z', false],
  ['2024-01-02T03:04:05.006100Z', '2024-01-02T03:04:05.006100Z', true],
  ['2024-01-02T03:04:05.006Z', '2024-01-02T03:04:05.006+00:00', true],
])
  test(`stored timestamp precision is preserved: ${canonicalTime} versus ${legacyTime}`, async () => {
    const { f, actor, source, input, comments } = await appendedDuplicates(1, {
      createdAt: canonicalTime,
    });
    try {
      // Append normalizes to milliseconds; model the full import's preserved
      // source timestamp in this synthetic canonical row before comparing it.
      await f.db.transaction((tx) =>
        tx.exec('UPDATE comments SET created_at=? WHERE workspace_id=? AND id=?', [
          canonicalTime,
          actor.workspace_id,
          targetId(actor.workspace_id, source.ids.org, 'comments', comments[0].id),
        ]),
      );
      await f.db.transaction((tx) =>
        tx.exec('UPDATE comments SET created_at=? WHERE workspace_id=? AND id=?', [
          legacyTime,
          actor.workspace_id,
          comments[0].id,
        ]),
      );
      const before = await f.db.transaction((tx) => tx.all('SELECT * FROM comments ORDER BY id'));
      const preview = await f.db.transaction((tx) => reconcileLinearComments(tx, actor, input));
      expect(preview.pairs).toHaveLength(matches ? 1 : 0);
      if (!matches) {
        expect(preview.ambiguous[0].reason).toBe('creation-time-mismatch');
        await assert.rejects(
          f.db.transaction((tx) =>
            reconcileLinearComments(tx, actor, { ...input, plan_hash: preview.plan_hash }),
          ),
          { code: 'NO_PROVEN_PAIRS' },
        );
      }
      expect(await f.db.transaction((tx) => tx.all('SELECT * FROM comments ORDER BY id'))).toEqual(
        before,
      );
    } finally {
      await f.close();
    }
  });

for (const table of ['activity', 'outbox'])
  test(`bounded preflight refuses oversized row count in ${table} before history fetch`, async () => {
    const { f, actor, input, run, legacy } = await duplicated();
    try {
      const plan = await run();
      await f.db.transaction((tx) =>
        tx.exec(
          table === 'activity'
            ? "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<100001) INSERT INTO activity(id,workspace_id,issue_id,actor_id,action,data,created_at) SELECT 'budget-' || i,?,?,?,'x','{}','x' FROM n"
            : "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<100001) INSERT INTO outbox(id,workspace_id,provider,event,payload,status,next_attempt_at,created_at) SELECT 'budget-' || i,?,'x','x','{}','done','x','x' FROM n",
          table === 'activity'
            ? [actor.workspace_id, legacy.issue_id, actor.id]
            : [actor.workspace_id],
        ),
      );
      const before = await f.db.transaction(async (tx) => ({
        comments: await tx.all('SELECT * FROM comments ORDER BY id'),
        mappings: await tx.all('SELECT * FROM linear_source_map ORDER BY collection,source_id'),
        receipts: await tx.all('SELECT * FROM linear_imports ORDER BY id'),
      }));
      for (const extra of [{}, { plan_hash: plan.plan_hash }]) {
        const queries = [];
        let budget;
        await assert.rejects(
          f.db.transaction((tx) =>
            reconcileLinearComments(
              {
                ...tx,
                one: async (sql, params) => {
                  queries.push(sql);
                  const row = await tx.one(sql, params);
                  if (sql.includes(`FROM ${table} WHERE`) && sql.includes('COUNT(*)')) budget = row;
                  return row;
                },
                all: async (sql, params) => {
                  queries.push(sql);
                  return tx.all(sql, params);
                },
              },
              actor,
              { ...input, ...extra },
            ),
          ),
          { code: 'REFERENCE_SCAN_BUDGET_EXCEEDED' },
        );
        expect(Number(budget.count)).toBeGreaterThan(100000);
        const scans = queries.filter((sql) => sql.includes(`FROM ${table} WHERE`));
        expect(scans).toHaveLength(1);
        expect(scans[0]).toMatch(
          /FROM \(SELECT .+ WHERE workspace_id=\? LIMIT 100001\) AS bounded_history/,
        );
      }
      expect(
        await f.db.transaction(async (tx) => ({
          comments: await tx.all('SELECT * FROM comments ORDER BY id'),
          mappings: await tx.all('SELECT * FROM linear_source_map ORDER BY collection,source_id'),
          receipts: await tx.all('SELECT * FROM linear_imports ORDER BY id'),
        })),
      ).toEqual(before);
    } finally {
      await f.close();
    }
  });

for (const table of ['activity', 'outbox']) {
  test(`streaming ${table}: large total history stays page bounded with complete archives`, async () => {
    const { f, actor, input, run, legacy } = await duplicated();
    try {
      const field = table === 'activity' ? 'data' : 'payload';
      await f.db.transaction(async (tx) => {
        const columns =
          table === 'activity'
            ? 'id,workspace_id,issue_id,actor_id,action,data,created_at'
            : 'id,workspace_id,provider,event,payload,status,next_attempt_at,created_at';
        const values =
          table === 'activity'
            ? "CASE WHEN i=0 THEN '' ELSE 'stream-' || substr('00000' || i,length('00000' || i)-4,5) END,?,?,?,'x',CASE WHEN i<1100 THEN ? ELSE '{}' END,'x'"
            : "CASE WHEN i=0 THEN '' ELSE 'stream-' || substr('00000' || i,length('00000' || i)-4,5) END,?,'x','x',CASE WHEN i<1100 THEN ? ELSE '{}' END,'done','x','x'";
        await tx.exec(
          `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i<3299) INSERT INTO ${table}(${columns}) SELECT ${values} FROM n`,
          table === 'activity'
            ? [actor.workspace_id, legacy.issue_id, actor.id, 'x'.repeat(9000)]
            : [actor.workspace_id, 'x'.repeat(9000)],
        );
        for (const i of [0, 880, 881, 1023, 1024, 2048, 3299]) {
          const id = i === 0 ? '' : 'stream-' + String(i).padStart(5, '0');
          const data =
            i === 1024
              ? legacy.id.toUpperCase()
              : i === 2048 && tx.dialect === 'sqlite'
                ? '\0' + legacy.id
                : legacy.id;
          await tx.exec(`UPDATE ${table} SET ${field}=? WHERE workspace_id=? AND id=?`, [
            table === 'outbox' ? JSON.stringify({ note: data }) : data,
            actor.workspace_id,
            id,
          ]);
        }
      });
      const expected = await f.db.transaction((tx) =>
        tx.all(`SELECT * FROM ${table} WHERE workspace_id=? AND ${field} LIKE ? ORDER BY id`, [
          actor.workspace_id,
          '%' + legacy.id + '%',
        ]),
      );
      const ids = await f.db.transaction((tx) =>
        tx.all(`SELECT id FROM ${table} WHERE workspace_id=? ORDER BY id`, [actor.workspace_id]),
      );
      const visited = [];
      const pageSizes = [];
      const preview = await f.db.transaction((tx) =>
        reconcileLinearComments(
          {
            ...tx,
            all: async (sql, params) => {
              const rows = await tx.all(sql, params);
              if (sql.includes(`FROM ${table} WHERE`) && !sql.includes('LIKE')) {
                const bytes = rows.reduce(
                  (sum, row) =>
                    sum +
                    Object.values(row).reduce(
                      (n, value) => n + (value == null ? 0 : Buffer.byteLength(String(value))),
                      0,
                    ),
                  0,
                );
                expect(bytes).toBeLessThanOrEqual(8000000);
                expect(rows.length).toBeLessThanOrEqual(1024);
                visited.push(...rows.map((row) => ({ id: row.id })));
                pageSizes.push(bytes);
              }
              return rows;
            },
          },
          actor,
          input,
        ),
      );
      expect(preview.pairs).toHaveLength(1);
      expect(visited).toEqual(ids);
      expect(new Set(visited.map((row) => row.id)).size).toBe(ids.length);
      expect(pageSizes.length).toBeGreaterThanOrEqual(4);
      expect(pageSizes.reduce((sum, size) => sum + size, 0)).toBeGreaterThan(8000000);
      console.info(`${f.db.dialect} ${table} stored page bytes: ${JSON.stringify(pageSizes)}`);
      const applied = await run({ plan_hash: preview.plan_hash });
      expect(applied.archived[0].references[table]).toEqual(expected);
    } finally {
      await f.close();
    }
  });
}

for (const table of ['activity', 'outbox']) {
  test(`streaming ${table}: migration provides workspace keyset index amid foreign history`, async () => {
    const { f, actor, input, legacy } = await duplicated();
    try {
      expect(await migrate(f.db)).toEqual({ applied: false, version: 9 });
      await f.db.transaction(async (tx) => {
        await tx.exec(
          "INSERT INTO workspaces(id,name,slug,created_at) VALUES('foreign-history','foreign','foreign','x')",
        );
        if (table === 'activity') {
          await tx.exec(
            "INSERT INTO memberships(workspace_id,user_id,role) VALUES('foreign-history',?,'owner')",
            [actor.id],
          );
          await tx.exec(
            "INSERT INTO teams(id,workspace_id,key,name) VALUES('foreign-team','foreign-history','F','foreign')",
          );
          await tx.exec(
            "INSERT INTO statuses(id,workspace_id,team_id,name,category,color,position) VALUES('foreign-status','foreign-history','foreign-team','Todo','unstarted','gray',0)",
          );
          await tx.exec(
            "INSERT INTO issues(id,workspace_id,team_id,number,key,title,status_id,creator_id,created_at,updated_at) VALUES('foreign-issue','foreign-history','foreign-team',1,'F-1','foreign','foreign-status',?,'x','x')",
            [actor.id],
          );
        }
        await tx.exec(
          table === 'activity'
            ? "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<20000) INSERT INTO activity(id,workspace_id,issue_id,actor_id,action,data,created_at) SELECT 'foreign-' || i,'foreign-history','foreign-issue',?,'x','{}','x' FROM n"
            : "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<20000) INSERT INTO outbox(id,workspace_id,provider,event,payload,status,next_attempt_at,created_at) SELECT 'foreign-' || i,'foreign-history','x','x','{}','done','x','x' FROM n",
          table === 'activity' ? [actor.id] : [],
        );
        await tx.exec(
          table === 'activity'
            ? "INSERT INTO activity(id,workspace_id,issue_id,actor_id,action,data,created_at) VALUES('zz-target',?,?,?,'x',?,'x')"
            : "INSERT INTO outbox(id,workspace_id,provider,event,payload,status,next_attempt_at,created_at) VALUES('zz-target',?,'x','x',?,'done','x','x')",
          table === 'activity'
            ? [actor.workspace_id, legacy.issue_id, actor.id, legacy.id]
            : [actor.workspace_id, JSON.stringify({ note: legacy.id })],
        );
        await tx.exec(`ANALYZE ${table}`);
        const plans = [];
        await reconcileLinearComments(
          {
            ...tx,
            all: async (sql, params) => {
              if (sql.includes(`FROM ${table} WHERE`)) {
                const plan = await tx.all(
                  (tx.dialect === 'sqlite' ? 'EXPLAIN QUERY PLAN ' : 'EXPLAIN ') + sql,
                  params,
                );
                plans.push(JSON.stringify(plan));
              }
              return tx.all(sql, params);
            },
          },
          actor,
          input,
        );
        expect(plans.length).toBeGreaterThan(0);
        for (const plan of plans) {
          expect(plan).toContain(`${table}_workspace_id`);
          if (tx.dialect === 'sqlite') expect(plan).toContain('workspace_id=? AND id=?');
        }
        console.info(`${tx.dialect} ${table} history plans: ${JSON.stringify(plans)}`);
      });
    } finally {
      await f.close();
    }
  });
}

for (const table of ['activity', 'outbox']) {
  test(`streaming ${table}: bounded rows exceeding selected archive bytes stay unresolved`, async () => {
    const { f, actor, run, legacy } = await duplicated();
    try {
      await f.db.transaction(async (tx) => {
        for (let i = 0; i < 2; i++) {
          const data = JSON.stringify({ id: legacy.id, note: 'x'.repeat(1100000) });
          await tx.exec(
            table === 'activity'
              ? 'INSERT INTO activity(id,workspace_id,issue_id,actor_id,action,data,created_at) VALUES(?,?,?,?,?,?,?)'
              : 'INSERT INTO outbox(id,workspace_id,provider,event,payload,status,next_attempt_at,created_at) VALUES(?,?,?,?,?,?,?,?)',
            table === 'activity'
              ? ['archive-' + i, actor.workspace_id, legacy.issue_id, actor.id, 'x', data, 'x']
              : ['archive-' + i, actor.workspace_id, 'x', 'x', data, 'done', 'x', 'x'],
          );
        }
      });
      const preview = await run();
      expect(preview.pairs).toEqual([]);
      expect(preview.ambiguous[0].reason).toBe('archive-budget-exceeded');
      await assert.rejects(run({ plan_hash: preview.plan_hash }), { code: 'NO_PROVEN_PAIRS' });
      expect(await f.db.transaction((tx) => tx.all('SELECT * FROM comments'))).toHaveLength(2);
    } finally {
      await f.close();
    }
  });
}

test('streaming migration upgrades existing version eight history without changing rows', async () => {
  const { f } = await duplicated();
  try {
    const snapshot = () =>
      f.db.transaction(async (tx) => ({
        activity: await tx.all('SELECT * FROM activity ORDER BY id'),
        outbox: await tx.all('SELECT * FROM outbox ORDER BY id'),
      }));
    const before = await snapshot();
    await f.db.transaction(async (tx) => {
      await tx.exec('DROP INDEX activity_workspace_id');
      await tx.exec('DROP INDEX outbox_workspace_id');
      await tx.exec('DROP INDEX comments_workspace_canonical_id');
      await tx.exec('DELETE FROM schema_migrations WHERE version=9');
    });
    expect(await migrate(f.db)).toEqual({ applied: true, version: 9 });
    expect(await migrate(f.db)).toEqual({ applied: false, version: 9 });
    expect(await snapshot()).toEqual(before);
    await f.db.transaction(async (tx) => {
      for (const table of ['activity', 'outbox']) {
        if (tx.dialect === 'sqlite') {
          const indexes = await tx.all(`PRAGMA index_list(${table})`);
          expect(indexes.find((index) => index.name === `${table}_workspace_id`).unique).toBe(0);
        } else {
          const index = await tx.one(
            'SELECT indexdef FROM pg_indexes WHERE schemaname=current_schema() AND indexname=?',
            [`${table}_workspace_id`],
          );
          expect(index.indexdef).toContain('(workspace_id, id)');
          expect(index.indexdef).not.toContain('UNIQUE');
        }
      }
    });
  } finally {
    await f.close();
  }
});

test('streaming admission refuses more than 100000 rows combined across history tables', async () => {
  const { f, actor, run, legacy } = await duplicated();
  try {
    await f.db.transaction(async (tx) => {
      await tx.exec(
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<50001) INSERT INTO activity(id,workspace_id,issue_id,actor_id,action,data,created_at) SELECT 'combined-' || i,?,?,?,'x','{}','x' FROM n",
        [actor.workspace_id, legacy.issue_id, actor.id],
      );
      await tx.exec(
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<50000) INSERT INTO outbox(id,workspace_id,provider,event,payload,status,next_attempt_at,created_at) SELECT 'combined-' || i,?,'x','x','{}','done','x','x' FROM n",
        [actor.workspace_id],
      );
    });
    await assert.rejects(run(), { code: 'REFERENCE_SCAN_BUDGET_EXCEEDED' });
    expect(await f.db.transaction((tx) => tx.all('SELECT * FROM comments'))).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test('release review: the archive cap includes complete source provenance', async () => {
  const { f, actor, input, comments } = await appendedDuplicates(1, {
    metadata: 'x'.repeat(900000),
  });
  try {
    await f.db.transaction(async (tx) => {
      const row = await tx.one('SELECT issue_id FROM comments WHERE id=?', [comments[0].id]);
      await tx.exec(
        'INSERT INTO activity(id,workspace_id,issue_id,actor_id,action,data,created_at) VALUES(?,?,?,?,?,?,?)',
        [
          crypto.randomUUID(),
          actor.workspace_id,
          row.issue_id,
          actor.id,
          'commented',
          JSON.stringify({ comment_id: comments[0].id, note: 'x'.repeat(1500000) }),
          '2024-01-01',
        ],
      );
    });
    const before = await f.db.transaction((tx) => tx.all('SELECT * FROM comments ORDER BY id'));
    const plan = await f.db.transaction((tx) => reconcileLinearComments(tx, actor, input));
    expect(plan.pairs).toHaveLength(0);
    expect(plan.ambiguous[0].reason).toBe('archive-budget-exceeded');
    await assert.rejects(
      f.db.transaction((tx) =>
        reconcileLinearComments(tx, actor, { ...input, plan_hash: plan.plan_hash }),
      ),
      { code: 'NO_PROVEN_PAIRS' },
    );
    expect(await f.db.transaction((tx) => tx.all('SELECT * FROM comments ORDER BY id'))).toEqual(
      before,
    );
  } finally {
    await f.close();
  }
});

test('release review: dense large-row history cannot amplify sizing work beyond a bounded multiple', async () => {
  const { f, actor, input, legacy } = await duplicated();
  try {
    await f.db.transaction(async (tx) => {
      const payload = JSON.stringify({ note: 'x'.repeat(4000000) });
      for (let i = 0; i < 10; i++)
        await tx.exec(
          'INSERT INTO activity(id,workspace_id,issue_id,actor_id,action,data,created_at) VALUES(?,?,?,?,?,?,?)',
          [
            crypto.randomUUID(),
            actor.workspace_id,
            legacy.issue_id,
            actor.id,
            'commented',
            payload,
            '2024-01-01',
          ],
        );
    });
    const before = await f.db.transaction((tx) => tx.all('SELECT * FROM comments ORDER BY id'));
    await assert.rejects(
      f.db.transaction((tx) => reconcileLinearComments(tx, actor, input)),
      { code: 'REFERENCE_SCAN_BUDGET_EXCEEDED' },
    );
    expect(await f.db.transaction((tx) => tx.all('SELECT * FROM comments ORDER BY id'))).toEqual(
      before,
    );
  } finally {
    await f.close();
  }
});
