/** The local operator command is tested against a synthetic on-disk database, without credentials. */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture } from './helpers.mjs';
import { sourceFixture } from './linear-import-fixture.mjs';
import { targetId, digest } from '../../packages/imports/linear-source.mjs';
import { runLocalCommentReconciliation } from '../../scripts/reconcile-linear-comments.mjs';

let directory, sqlitePath, baseArgs;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'comment-repair-'));
  sqlitePath = join(directory, 'synthetic.sqlite');
  const f = await fixture({}, { sqlitePath });
  const source = sourceFixture();
  let closed = false;
  try {
    const run = (await f.request('POST', '/api/v1/imports/linear', { manifest: source.manifest }))
      .data.id;
    for (const [collection, records] of Object.entries(source.data))
      if (records.length)
        expect(
          (
            await f.request('POST', `/api/v1/imports/linear/${run}/records`, {
              collection,
              records,
            })
          ).status,
        ).toBe(200);
    const plan = (await f.request('POST', `/api/v1/imports/linear/${run}/plan`)).data;
    expect(
      (
        await f.request('POST', `/api/v1/imports/linear/${run}/apply`, {
          plan_hash: plan.plan_hash,
        })
      ).status,
    ).toBe(200);
    const canonicalId = targetId(
      f.init.workspace_id,
      source.ids.org,
      'comments',
      source.ids.comment,
    );
    await f.db.transaction((tx) =>
      tx.exec(
        'INSERT INTO comments(id,workspace_id,issue_id,author_id,author_source_id,body,created_at,updated_at,version) SELECT ?,workspace_id,issue_id,author_id,author_source_id,body,created_at,updated_at,version FROM comments WHERE id=?',
        [source.ids.comment, canonicalId],
      ),
    );
    baseArgs = [
      '--sqlite',
      sqlitePath,
      '--workspace',
      f.init.workspace_id,
      '--actor',
      f.init.user_id,
      '--source',
      source.ids.org,
      '--comment',
      source.ids.comment,
    ];
    await f.close();
    closed = true;
  } finally {
    if (!closed) await f.close();
  }
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true });
});
async function copyArgs() {
  const path = join(directory, crypto.randomUUID() + '.sqlite');
  // Serialize a consistent snapshot, including committed pages still in the WAL.
  const snapshot = new Database(sqlitePath, { readonly: true, create: false });
  try {
    await writeFile(path, snapshot.serialize());
  } finally {
    snapshot.close();
  }
  const args = [...baseArgs];
  args[1] = path;
  return args;
}
test('SQLite preview and stale-plan rejection leave database bytes unchanged', async () => {
  const args = await copyArgs();
  const before = digest(await readFile(args[1]));
  const preview = await runLocalCommentReconciliation(args);
  expect(preview.pairs).toHaveLength(1);
  expect(preview.applied).toBe(false);
  expect(digest(await readFile(args[1]))).toBe(before);
  await assert.rejects(runLocalCommentReconciliation([...args, '--apply-plan', '0'.repeat(64)]), {
    code: 'PLAN_CHANGED',
  });
  expect(digest(await readFile(args[1]))).toBe(before);
});
test('SQLite applies a reviewed hash and replays its receipt', async () => {
  const args = await copyArgs();
  const preview = await runLocalCommentReconciliation(args);
  const repaired = await runLocalCommentReconciliation([
    ...args,
    '--apply-plan',
    preview.plan_hash,
  ]);
  expect(repaired.applied).toBe(true);
  expect(repaired.after_count).toBe(1);
  const replay = await runLocalCommentReconciliation([...args, '--apply-plan', preview.plan_hash]);
  expect(replay).toEqual({ ...repaired, unchanged: true });
  expect((await runLocalCommentReconciliation(args)).pairs).toEqual([]);
});
test('SQLite executable previews and enforces argument selection and actual membership', async () => {
  const args = await copyArgs();
  const command = Bun.spawn([process.execPath, 'scripts/reconcile-linear-comments.mjs', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [output, error, code] = await Promise.all([
    new Response(command.stdout).text(),
    new Response(command.stderr).text(),
    command.exited,
  ]);
  expect(error).toBe('');
  expect(code).toBe(0);
  expect(JSON.parse(output).pairs).toHaveLength(1);
  await assert.rejects(
    runLocalCommentReconciliation([...args, '--force', 'yes']),
    /distinct named arguments/,
  );
  const badActor = [...args];
  badActor[5] = crypto.randomUUID();
  await assert.rejects(runLocalCommentReconciliation(badActor), /no membership/);
});
