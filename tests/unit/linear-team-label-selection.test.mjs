import { test, expect } from 'bun:test';
import { configured } from './linear-live-queue.test.mjs';
import { sourceFixture } from './linear-import-fixture.mjs';
import {
  referenceResolver,
  registerSource,
  loadNative,
} from '../../packages/server/modules/linear-live/context.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';
async function scenario(scope) {
  const source = sourceFixture();
  source.data.issueLabels[0].team =
    scope === 'own'
      ? { id: source.ids.team }
      : scope === 'other'
        ? { id: crypto.randomUUID() }
        : null;
  const f = await configured(source);
  f.labelId = targetId(f.config.workspaceId, source.ids.org, 'issueLabels', source.ids.label);
  f.issueId = targetId(f.config.workspaceId, source.ids.org, 'issues', source.ids.issue);
  f.resolve = () =>
    f.f.db.transaction(async (tx) =>
      referenceResolver(
        tx,
        f.config,
        'issues',
        null,
        null,
        await loadNative(tx, f.config, 'issues', f.issueId),
      ),
    );
  return f;
}
test('a recorded foreign-team label is never sent with an issue in another team', async () => {
  const f = await scenario('other');
  try {
    const resolver = await f.resolve();
    expect(() => resolver.reverse('issueLabels', f.labelId)).toThrow();
  } finally {
    await f.f.close();
  }
});
test('a matching team label wins over the other-team mapping of the same native label', async () => {
  const f = await scenario('other');
  try {
    const id = crypto.randomUUID();
    await f.f.db.transaction((tx) =>
      registerSource(
        tx,
        f.config,
        'issueLabels',
        { ...f.source.data.issueLabels[0], id, team: { id: f.source.ids.team } },
        f.labelId,
      ),
    );
    expect((await f.resolve()).reverse('issueLabels', f.labelId)).toBe(id);
  } finally {
    await f.f.close();
  }
});
test('a verified global source label remains valid for an issue team', async () => {
  const f = await scenario('global');
  try {
    expect((await f.resolve()).reverse('issueLabels', f.labelId)).toBe(f.source.ids.label);
  } finally {
    await f.f.close();
  }
});
