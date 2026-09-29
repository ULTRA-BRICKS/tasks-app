import { test, expect } from 'bun:test';
import { numberingSetup, renumber } from './linear-numbering-fixture.mjs';
const history = (f, code, options) =>
  f.request('GET', '/api/v1/issues/pre-canonical/' + code, undefined, options);
/** Source fixture order: records[0] is Child (SRC-8), records[1] is Parent (SRC-7). */
const swapped = (input) => ({
  ...input,
  records: input.records.map((record, index) => ({
    ...record,
    code: input.records[1 - index].code,
  })),
});
test('an old code resolves through the migration receipt while the bare code keeps its current holder', async () => {
  const { f, ids, input } = await numberingSetup();
  const [child, parent] = ids;
  try {
    expect((await f.request('GET', '/api/v1/issues/SRC-7')).data.id).toBe(parent);
    const migration = await renumber(f, swapped(input));
    const receipt = await f.db.transaction((tx) =>
      tx.one(
        "SELECT payload FROM outbox WHERE workspace_id=? AND id=? AND provider='linear-numbering' AND event='canonical-migration' AND status='state'",
        [f.init.workspace_id, migration.id],
      ),
    );
    expect(JSON.parse(receipt.payload).pairs).toContainEqual(
      expect.objectContaining({ id: parent, oldCode: 'SRC-7', newCode: 'SRC-8' }),
    );
    const found = await history(f, 'SRC-7');
    expect(found.status).toBe(200);
    expect(found.data).toMatchObject({ code: 'SRC-7', origin: 'pre-canonical', ambiguous: false });
    expect(found.data.matches).toHaveLength(1);
    expect(found.data.matches[0].task).toMatchObject({ id: parent, key: 'SRC-8', title: 'Parent' });
    expect(found.data.matches[0].steps).toEqual([
      { migration_id: migration.id, at: expect.any(String), from: 'SRC-7', to: 'SRC-8' },
    ]);
    expect(found.data.current).toMatchObject({ id: child, key: 'SRC-7', title: 'Child' });
    expect((await f.request('GET', '/api/v1/issues/SRC-7')).data.id).toBe(child);
    await f.db.transaction((tx) =>
      tx.exec('UPDATE issues SET deleted_at=? WHERE workspace_id=? AND id=?', [
        '2026-09-29T10:00:00.000Z',
        f.init.workspace_id,
        parent,
      ]),
    );
    const deleted = (await history(f, 'SRC-7')).data;
    expect(deleted.matches[0].task).toBeNull();
    expect(deleted.matches[0].steps).toEqual(found.data.matches[0].steps);
  } finally {
    await f.close();
  }
});
test('a code the renumbering kept resolves to the same task with a kept step', async () => {
  const { f, ids, input } = await numberingSetup();
  const parent = ids[1];
  try {
    const migration = await renumber(f, input);
    const found = (await history(f, 'SRC-7')).data;
    expect(found.ambiguous).toBe(false);
    expect(found.matches).toEqual([
      {
        task: expect.objectContaining({ id: parent, key: 'SRC-7' }),
        steps: [{ migration_id: migration.id, at: expect.any(String), from: 'SRC-7', to: 'SRC-7' }],
      },
    ]);
    expect(found.current.id).toBe(parent);
  } finally {
    await f.close();
  }
});
test('a code reused across renumberings lists every task newest first instead of choosing one', async () => {
  const { f, ids, input } = await numberingSetup();
  const [child, parent] = ids;
  try {
    const first = await renumber(f, swapped(input));
    // Receipt stamps are the only chronology; make the older migration unmistakably older.
    await f.db.transaction((tx) =>
      tx.exec('UPDATE outbox SET created_at=? WHERE workspace_id=? AND id=?', [
        '2026-09-25T10:00:00.000Z',
        f.init.workspace_id,
        first.id,
      ]),
    );
    const second = await renumber(f, input);
    const found = await history(f, 'SRC-7');
    expect(found.status).toBe(200);
    expect(found.data.ambiguous).toBe(true);
    expect(found.data.matches.map((m) => m.task.id)).toEqual([child, parent]);
    expect(found.data.matches[0].task.key).toBe('SRC-8');
    expect(found.data.matches[0].steps).toEqual([
      { migration_id: second.id, at: expect.any(String), from: 'SRC-7', to: 'SRC-8' },
    ]);
    expect(found.data.matches[1].task.key).toBe('SRC-7');
    expect(found.data.matches[1].steps).toEqual([
      {
        migration_id: first.id,
        at: '2026-09-25T10:00:00.000Z',
        from: 'SRC-7',
        to: 'SRC-8',
      },
      { migration_id: second.id, at: expect.any(String), from: 'SRC-8', to: 'SRC-7' },
    ]);
    expect(found.data.current.id).toBe(parent);
  } finally {
    await f.close();
  }
});
test("another workspace's renumbering history never resolves or adds matches", async () => {
  const { f, ids, input } = await numberingSetup();
  const [child, parent] = ids;
  try {
    const other = crypto.randomUUID();
    await f.db.transaction(async (tx) => {
      await tx.exec('INSERT INTO workspaces(id,name,slug,created_at) VALUES(?,?,?,?)', [
        other,
        'Other workspace',
        'other-history',
        '2026-09-20T10:00:00.000Z',
      ]);
      // Adversarial foreign receipt: same code, pointing at this workspace's task UUID.
      await tx.exec(
        "INSERT INTO outbox(id,workspace_id,provider,event,payload,status,attempts,next_attempt_at,created_at) VALUES(?,?,'linear-numbering','canonical-migration',?,'state',0,?,?)",
        [
          crypto.randomUUID(),
          other,
          JSON.stringify({
            pairs: [
              { id: child, oldCode: 'SRC-7', newCode: 'SRC-9' },
              { id: crypto.randomUUID(), oldCode: 'OTH-5', newCode: 'OTH-6' },
            ],
          }),
          '2026-09-28T10:00:00.000Z',
          '2026-09-28T10:00:00.000Z',
        ],
      );
    });
    expect((await history(f, 'OTH-5')).status).toBe(404);
    expect((await history(f, 'SRC-7')).status).toBe(404);
    await renumber(f, swapped(input));
    const found = (await history(f, 'SRC-7')).data;
    expect(found.ambiguous).toBe(false);
    expect(found.matches.map((m) => m.task.id)).toEqual([parent]);
  } finally {
    await f.close();
  }
});
test('unknown and malformed codes return a Tasks not-found error; anonymous requests are rejected', async () => {
  const { f, input } = await numberingSetup();
  try {
    await renumber(f, swapped(input));
    for (const code of ['NOPE-1', 'SRC-07', 'src-7', 'x', '..%2Fusers', 'SRC-7%2Fcomments']) {
      const missing = await history(f, code);
      expect(missing.status).toBe(404);
      expect(missing.data.error.code).toBe('NOT_FOUND');
      expect(missing.data.error.message).toBe('No task had this code before canonical renumbering');
    }
    expect((await history(f, 'SRC-7', { anonymous: true })).status).toBe(401);
  } finally {
    await f.close();
  }
});
test('an unreadable receipt fails the lookup instead of returning a chain that may miss a task', async () => {
  const { f, input } = await numberingSetup();
  try {
    await renumber(f, swapped(input));
    for (const payload of ['{"pairs":', JSON.stringify({ pairs: [{ id: 'x', oldCode: 7 }] })]) {
      const corrupt = crypto.randomUUID();
      await f.db.transaction((tx) =>
        tx.exec(
          "INSERT INTO outbox(id,workspace_id,provider,event,payload,status,attempts,next_attempt_at,created_at) VALUES(?,?,'linear-numbering','canonical-migration',?,'state',0,?,?)",
          [
            corrupt,
            f.init.workspace_id,
            payload,
            '2026-09-28T10:00:00.000Z',
            '2026-09-28T10:00:00.000Z',
          ],
        ),
      );
      const failed = await history(f, 'SRC-7');
      expect(failed.status).toBe(500);
      expect(failed.data.error.code).toBe('INVALID_NUMBERING_RECEIPT');
      await f.db.transaction((tx) => tx.exec('DELETE FROM outbox WHERE id=?', [corrupt]));
    }
    expect((await history(f, 'SRC-7')).status).toBe(200);
  } finally {
    await f.close();
  }
});
