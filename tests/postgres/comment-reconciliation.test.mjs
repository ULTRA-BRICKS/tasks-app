/** Synthetic PostgreSQL acceptance only: isolated fixture schemas, never an operator migration. */
import { test, expect } from 'bun:test';
import assert from 'node:assert/strict';
import { bindLinearSources } from '../../packages/server/modules/linear-import/bind.mjs';
import { reconcileLinearComments } from '../../packages/server/modules/linear-import/reconcile-comments.mjs';
import { createDatabase } from '../../packages/db/index.mjs';
import { runLocalCommentReconciliation } from '../../scripts/reconcile-linear-comments.mjs';

if (!process.env.TEST_DATABASE_URL)
  throw Error(
    'TEST_DATABASE_URL must explicitly point at a coordinator-provided synthetic PostgreSQL server',
  );
// Reuse all relational, privacy, audit rollback and signed replay assertions on PostgreSQL.
const { duplicated } = await import('../unit/linear-comment-reconciliation.test.mjs');

test('PostgreSQL operator previews read-only, applies at read committed and replays the preserved receipt', async () => {
  const { f, source, actor, canonical, legacy } = await duplicated();
  try {
    expect(f.db.dialect).toBe('postgres');
    const schema = await f.db.transaction((tx) => tx.one('SELECT current_schema() AS name'));
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', `-c search_path=${schema.name}`);
    const args = [
      '--postgres-env',
      'SYNTHETIC_REPAIR_URL',
      '--workspace',
      actor.workspace_id,
      '--actor',
      actor.id,
      '--source',
      source.ids.org,
      '--comment',
      source.ids.comment,
    ];
    const observed = [];
    const options = {
      env: { SYNTHETIC_REPAIR_URL: url.toString() },
      openDatabase: async (config) => {
        const db = await createDatabase(config);
        return {
          close: () => db.close(),
          transaction: (fn, settings) =>
            db.transaction(async (tx) => {
              observed.push({
                readonly: (await tx.one('SHOW transaction_read_only')).transaction_read_only,
              });
              const result = await fn(tx);
              observed.push(
                await tx.one("SELECT current_setting('transaction_isolation') AS isolation"),
              );
              return result;
            }, settings),
        };
      },
    };
    const snapshot = () =>
      f.db.transaction(async (tx) => ({
        comments: await tx.all('SELECT * FROM comments ORDER BY id'),
        activity: await tx.all('SELECT * FROM activity ORDER BY id'),
        imports: await tx.all('SELECT * FROM linear_imports ORDER BY id'),
        mappings: await tx.all('SELECT * FROM linear_source_map ORDER BY collection,source_id'),
        outbox: await tx.all('SELECT * FROM outbox ORDER BY id'),
      }));
    const before = await snapshot();
    const preview = await runLocalCommentReconciliation(args, options);
    expect(preview.pairs).toHaveLength(1);
    expect(observed.splice(0)).toEqual([{ readonly: 'on' }, { isolation: 'repeatable read' }]);
    expect(await snapshot()).toEqual(before);
    await assert.rejects(
      runLocalCommentReconciliation([...args, '--apply-plan', '0'.repeat(64)], options),
      { code: 'PLAN_CHANGED' },
    );
    expect(await snapshot()).toEqual(before);
    observed.length = 0;
    const applied = await runLocalCommentReconciliation(
      [...args, '--apply-plan', preview.plan_hash],
      options,
    );
    expect(observed.splice(0)).toEqual([{ readonly: 'off' }, { isolation: 'read committed' }]);
    expect(applied.archived[0].legacy).toEqual(legacy);
    expect(applied.archived[0].canonical).toEqual(canonical);
    expect(applied.after_count).toBe(1);
    expect(
      await runLocalCommentReconciliation([...args, '--apply-plan', preview.plan_hash], options),
    ).toEqual({ ...applied, unchanged: true });
    const after = await snapshot();
    expect(after.comments).toEqual([canonical]);
    expect(after.mappings).toEqual(before.mappings);
    expect(after.outbox).toEqual(before.outbox);
    expect(
      after.activity.filter((row) => before.activity.some((old) => old.id === row.id)),
    ).toEqual(before.activity);
    expect(after.imports.filter((row) => before.imports.some((old) => old.id === row.id))).toEqual(
      before.imports,
    );
  } finally {
    await f.close();
  }
});

for (const change of ['binding', 'membership'])
  test(`two connections: apply sees ${change} committed while waiting for workspace lock`, async () => {
    const { f, source, actor, legacy, run } = await duplicated();
    /** @type {{ promise: Promise<{error: unknown}> }} */
    const applying = { promise: Promise.resolve({ error: null }) };
    try {
      const preview = await run();
      const schema = await f.db.transaction((tx) => tx.one('SELECT current_schema() AS name'));
      const url = new URL(process.env.TEST_DATABASE_URL);
      url.searchParams.set('options', `-c search_path=${schema.name}`);
      const args = [
        '--postgres-env',
        'SYNTHETIC_REPAIR_URL',
        '--workspace',
        actor.workspace_id,
        '--actor',
        actor.id,
        '--source',
        source.ids.org,
        '--comment',
        source.ids.comment,
        '--apply-plan',
        preview.plan_hash,
      ];
      const snapshot = async (tx) => ({
        comments: await tx.all('SELECT * FROM comments ORDER BY id'),
        mappings: await tx.all('SELECT * FROM linear_source_map ORDER BY collection,source_id'),
        receipts: await tx.all('SELECT * FROM linear_imports ORDER BY id'),
        activity: await tx.all('SELECT * FROM activity ORDER BY id'),
      });
      const committed = await f.db.transaction(async (holder) => {
        await holder.exec('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
        await holder.lock(actor.workspace_id);
        applying.promise = runLocalCommentReconciliation(args, {
          env: { SYNTHETIC_REPAIR_URL: url.toString() },
        }).then(
          () => ({ error: null }),
          (error) => ({ error }),
        );
        const deadline = Date.now() + 3000;
        let waiting = false;
        while (Date.now() < deadline) {
          const row = await holder.one(
            "SELECT COUNT(*) AS count FROM pg_locks WHERE locktype='advisory' AND objid=CAST(CAST(hashtext(?) AS bigint) & 4294967295 AS oid) AND NOT granted",
            [actor.workspace_id],
          );
          if (Number(row.count) === 1) {
            waiting = true;
            break;
          }
        }
        expect(waiting).toBe(true);
        if (change === 'binding') {
          const binding = {
            source_workspace_id: source.ids.org,
            bindings: [
              {
                collection: 'comments',
                record: { ...source.data.comments[0], id: crypto.randomUUID() },
                target_id: legacy.id,
              },
            ],
          };
          const plan = await bindLinearSources(holder, actor, binding);
          await bindLinearSources(holder, actor, { ...binding, plan_hash: plan.plan_hash });
        } else {
          await holder.exec(
            "UPDATE memberships SET role='member' WHERE workspace_id=? AND user_id=?",
            [actor.workspace_id, actor.id],
          );
        }
        return snapshot(holder);
      });
      const outcome = await applying.promise;
      expect(outcome.error).toBeInstanceOf(Error);
      expect(outcome.error).toMatchObject({
        code: change === 'binding' ? 'PLAN_CHANGED' : 'FORBIDDEN',
      });
      expect(await f.db.transaction(snapshot)).toEqual(committed);
      expect(committed.comments.some((row) => row.id === legacy.id)).toBe(true);
    } finally {
      await applying.promise;
      await f.close();
    }
  });

for (const isolation of ['REPEATABLE READ', 'SERIALIZABLE'])
  test(`direct apply rejects unsupported ${isolation} snapshot`, async () => {
    const { f, actor, input, run } = await duplicated();
    try {
      const preview = await run();
      await assert.rejects(
        f.db.transaction(async (tx) => {
          await tx.exec(`SET TRANSACTION ISOLATION LEVEL ${isolation}`);
          await tx.one('SELECT COUNT(*) FROM comments');
          return reconcileLinearComments(tx, actor, { ...input, plan_hash: preview.plan_hash });
        }),
        { code: 'UNSUPPORTED_RECONCILIATION_ISOLATION' },
      );
    } finally {
      await f.close();
    }
  });
