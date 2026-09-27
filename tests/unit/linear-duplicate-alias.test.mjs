import assert from 'node:assert/strict';
import { test, expect } from 'bun:test';
import { configured } from './linear-live-queue.test.mjs';
import { writeEntityState } from '../../packages/server/modules/linear-live/store.mjs';
import { nativeInScope } from '../../packages/server/modules/linear-live/scope.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';
test('an explicitly retired duplicate is retained but cannot be exported as another new object', async () => {
  const { f, actor, source, config } = await configured();
  try {
    const canonical = targetId(actor.workspace_id, source.ids.org, 'projects', source.ids.project);
    const duplicate = (
      await f.request('POST', '/api/v1/projects', {
        name: 'Retained old copy',
        team_ids: [targetId(actor.workspace_id, source.ids.org, 'teams', source.ids.team)],
      })
    ).data;
    await f.db.transaction((tx) =>
      writeEntityState(tx, actor.workspace_id, 'projects', duplicate.id, {
        collection: 'projects',
        sourceId: duplicate.id,
        targetId: duplicate.id,
        supersededBy: canonical,
        resolution: 'operator-duplicate-resolution',
      }),
    );
    expect(await f.db.transaction((tx) => nativeInScope(tx, config, 'projects', duplicate))).toBe(
      false,
    );
    expect(
      await f.db.transaction((tx) =>
        tx.one('SELECT name FROM projects WHERE workspace_id=? AND id=?', [
          actor.workspace_id,
          duplicate.id,
        ]),
      ),
    ).toEqual({ name: 'Retained old copy' });
    await f.db.transaction((tx) =>
      writeEntityState(tx, actor.workspace_id, 'projects', duplicate.id, {
        supersededBy: crypto.randomUUID(),
        resolution: 'operator-duplicate-resolution',
      }),
    );
    await assert.rejects(
      f.db.transaction((tx) => nativeInScope(tx, config, 'projects', duplicate)),
      (error) => error.code === 'SYNC_ALIAS_INVALID',
    );
  } finally {
    await f.close();
  }
});
