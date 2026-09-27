import { test, expect } from 'bun:test';
import { configured } from './linear-live-queue.test.mjs';
import { createProject, updateProject } from '../../packages/server/modules/planning/service.mjs';
import {
  createKnowledge,
  updateKnowledge,
} from '../../packages/server/modules/knowledge/service.mjs';
test('native projects, documents and initiatives enqueue durable outbound work in the same transaction', async () => {
  const { f, actor } = await configured();
  try {
    const created = await f.db.transaction(async (tx) => {
      const project = await createProject(tx, actor, {
        name: 'Outbound project',
        team_ids: [f.init.team_id],
      });
      const document = await createKnowledge(tx, actor, 'documents', {
        title: 'Outbound document',
        body: 'Original',
      });
      const initiative = await createKnowledge(tx, actor, 'initiatives', {
        name: 'Outbound initiative',
      });
      return { project, document, initiative };
    });
    const jobs = await f.db.transaction((tx) =>
      tx.all("SELECT payload FROM outbox WHERE provider='linear' AND status='pending'"),
    );
    expect(jobs.map((r) => JSON.parse(r.payload).collection).sort()).toEqual([
      'documents',
      'initiatives',
      'projects',
    ]);
    await f.db.transaction(async (tx) => {
      await updateProject(tx, actor, created.project.id, { version: 1, name: 'Changed project' });
      await updateKnowledge(tx, actor, 'documents', created.document.id, {
        version: 1,
        body: 'Changed',
      });
      await updateKnowledge(tx, actor, 'initiatives', created.initiative.id, {
        version: 1,
        name: 'Changed initiative',
      });
    });
    expect(
      (
        await f.db.transaction((tx) =>
          tx.all("SELECT id FROM outbox WHERE provider='linear' AND status='pending'"),
        )
      ).length,
    ).toBe(3);
    await f.db.transaction((tx) =>
      updateProject(tx, { ...actor, syncOrigin: 'linear' }, created.project.id, {
        version: 2,
        name: 'Source applied',
      }),
    );
    expect(
      (
        await f.db.transaction((tx) =>
          tx.all("SELECT id FROM outbox WHERE provider='linear' AND status='pending'"),
        )
      ).length,
    ).toBe(3);
  } finally {
    await f.close();
  }
});
