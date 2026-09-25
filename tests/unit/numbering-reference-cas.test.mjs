import { test, expect } from 'bun:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { applyReferenceEdits } from '../../packages/server/modules/linear-numbering/apply.mjs';
test('reference rewriting never overwrites a concurrent comment edit', async () => {
  const f = await fixture();
  try {
    const issue = (await f.create()).data,
      comment = (
        await f.request('POST', '/api/v1/issues/' + issue.id + '/comments', { body: 'See HYP-10' })
      ).data;
    await f.db.transaction((tx) =>
      tx.exec('UPDATE comments SET body=?,version=version+1 WHERE id=?', [
        'New user text',
        comment.id,
      ]),
    );
    await assert.rejects(
      f.db.transaction((tx) =>
        applyReferenceEdits(
          tx,
          f.init.workspace_id,
          [
            {
              table: 'comments',
              id: comment.id,
              field: 'body',
              before: 'See HYP-10',
              after: 'See HYP-11',
              version: comment.version,
            },
          ],
          new Set(),
          new Date().toISOString(),
        ),
      ),
      (error) => error.code === 'REFERENCE_VERSION_CONFLICT',
    );
    const row = await f.db.transaction((tx) =>
      tx.one('SELECT body,version FROM comments WHERE id=?', [comment.id]),
    );
    expect(row.body).toBe('New user text');
    expect(row.version).toBe(comment.version + 1);
  } finally {
    await f.close();
  }
});
test('multiple edited fields of one document consume exactly one optimistic version', async () => {
  const f = await fixture();
  try {
    const issue = (await f.create({ title: 'HYP-10', description: 'See HYP-10' })).data;
    await f.db.transaction((tx) =>
      applyReferenceEdits(
        tx,
        f.init.workspace_id,
        [
          {
            table: 'issues',
            id: issue.id,
            field: 'title',
            before: 'HYP-10',
            after: 'HYP-11',
            version: issue.version,
          },
          {
            table: 'issues',
            id: issue.id,
            field: 'description',
            before: 'See HYP-10',
            after: 'See HYP-11',
            version: issue.version,
          },
        ],
        new Set(),
        new Date().toISOString(),
      ),
    );
    const got = (await f.request('GET', '/api/v1/issues/' + issue.id)).data;
    expect(got.version).toBe(issue.version + 1);
    expect(got.title).toBe('HYP-11');
    expect(got.description).toBe('See HYP-11');
  } finally {
    await f.close();
  }
});

test('a large occupied-code cycle uses bounded SQL batches and preserves all task identities', async () => {
  const { applyCodeChanges } =
    await import('../../packages/server/modules/linear-numbering/apply.mjs');
  const f = await fixture();
  try {
    const first = (await f.create({ title: 'Cycle member' })).data;
    const template = await f.db.transaction((tx) =>
      tx.one('SELECT * FROM issues WHERE id=?', [first.id]),
    );
    const prefix = first.key.split('-')[0];
    const rows = Array.from({ length: 250 }, (_, i) => ({
      ...template,
      id: i === 0 ? first.id : crypto.randomUUID(),
      key: prefix + '-' + (i + 1),
      number: i + 1,
    }));
    await f.db.transaction(async (tx) => {
      for (let start = 1; start < rows.length; start += 50) {
        const batch = rows.slice(start, start + 50),
          keys = Object.keys(template);
        await tx.exec(
          `INSERT INTO issues(${keys.join(',')}) VALUES ${batch.map(() => `(${keys.map(() => '?').join(',')})`).join(',')}`,
          batch.flatMap((row) => keys.map((key) => row[key])),
        );
      }
    });
    const changes = rows.map((row, i) => ({
      id: row.id,
      teamId: row.team_id,
      version: row.version,
      newCode: prefix + '-' + (((i + 1) % 250) + 1),
      newNumber: ((i + 1) % 250) + 1,
    }));
    let writes = 0;
    await f.db.transaction((tx) =>
      applyCodeChanges(
        {
          ...tx,
          exec: async (sql, args) => {
            writes++;
            return tx.exec(sql, args);
          },
        },
        f.init.workspace_id,
        changes,
        rows,
        crypto.randomUUID(),
        new Date().toISOString(),
      ),
    );
    expect(writes).toBe(6);
    const stored = await f.db.transaction((tx) =>
      tx.all('SELECT id,key,number,version,title FROM issues WHERE workspace_id=?', [
        f.init.workspace_id,
      ]),
    );
    const byId = new Map(stored.map((r) => [r.id, r]));
    expect(stored).toHaveLength(250);
    for (const change of changes) {
      const row = byId.get(change.id);
      expect(row.key).toBe(change.newCode);
      expect(row.number).toBe(change.newNumber);
      expect(row.title).toBe('Cycle member');
      expect(row.version).toBe(2);
    }
  } finally {
    await f.close();
  }
});
