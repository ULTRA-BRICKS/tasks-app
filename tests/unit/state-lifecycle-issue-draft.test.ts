import { expect, test } from 'bun:test';
import type { Issue, IssueCreate } from '@tickets/contracts';
import { ApiError } from '../../src/shared/api/client';
import { createIssueDraftController } from '../../src/pages/issue-new/draft-controller';
import { newIssueDraft } from '../../src/pages/issue-new/model';
import { deferred, memoryStorage, syntheticIssue } from '../fixtures/state-migration';

const KEY = 'ticket-new:ws-1:user-1:issue::::::::';
const ready = { team: 'team-1', status: 'status-todo', readOnly: false };
type Options = Parameters<typeof createIssueDraftController>[0];
function setup(over: Partial<Options> = {}) {
  let counter = 0;
  const storage = memoryStorage();
  const controller = createIssueDraftController({
    key: KEY,
    incoming: {},
    storage,
    submit: () => Promise.resolve(syntheticIssue(1)),
    onCreated: () => {},
    describeError: (error) => (error instanceof Error ? error.message : String(error)),
    newKey: () => `key-${++counter}`,
    ...over,
  });
  return { controller, storage };
}
const stored = (extra: object) => JSON.stringify({ ...newIssueDraft({ title: 'Kept' }), ...extra });

test('a malformed stored attempt is dropped but the draft text is kept', () => {
  for (const attempt of [{}, { key: 123, input: 'x' }, { key: 'k' }, null, 'nope']) {
    const seeded = memoryStorage({ [KEY]: stored({ attempt }) });
    const { controller } = setup({ storage: seeded });
    const view = controller.getSnapshot();
    expect(view.draft.title).toBe('Kept');
    expect(view.draft.attempt).toBeUndefined();
    expect(view.frozen).toBe(false);
  }
});

test('a well-formed stored attempt is restored with its key', () => {
  const attempt = { key: 'k-1', input: { title: 'Kept', team_id: 't' } as IssueCreate };
  const { controller } = setup({ storage: memoryStorage({ [KEY]: stored({ attempt }) }) });
  expect(controller.getSnapshot().draft.attempt?.key).toBe('k-1');
  expect(controller.getSnapshot().frozen).toBe(true);
});

test('a permanent rejection that completes after disposal clears the stored attempt', async () => {
  const gate = deferred<Issue>();
  const { controller, storage } = setup({ submit: () => gate.promise });
  controller.change({ title: 'Offscreen' });
  const running = controller.create(ready);
  expect(JSON.parse(storage.data.get(KEY)!).attempt.key).toBe('key-1');
  controller.dispose();
  gate.reject(new ApiError(422, 'INVALID', 'Bad title'));
  await running;
  const restored = JSON.parse(storage.data.get(KEY)!);
  expect(restored.title).toBe('Offscreen');
  expect(restored.attempt).toBeUndefined();
});

test('a retryable failure after disposal keeps the attempt and its key', async () => {
  const gate = deferred<Issue>();
  const { controller, storage } = setup({ submit: () => gate.promise });
  controller.change({ title: 'Offscreen' });
  const running = controller.create(ready);
  controller.dispose();
  gate.reject(new ApiError(500, 'BOOM', 'Server error'));
  await running;
  expect(JSON.parse(storage.data.get(KEY)!).attempt.key).toBe('key-1');
});

test('a late successful response does not delete a newer saved draft', async () => {
  const gate = deferred<Issue>(),
    { controller, storage } = setup({ submit: () => gate.promise });
  controller.change({ title: 'First' });
  const running = controller.create(ready);
  controller.dispose();
  const newer = stored({
    title: 'New draft',
    attempt: { key: 'new-key', input: { title: 'New draft', team_id: 'team-1' } },
  });
  storage.data.set(KEY, newer);
  gate.resolve(syntheticIssue(2));
  await running;
  expect(storage.data.get(KEY)).toBe(newer);
});
test('a disposed controller cannot start another create', async () => {
  let calls = 0;
  const { controller } = setup({
    submit: () => {
      calls++;
      return Promise.resolve(syntheticIssue(1));
    },
  });
  controller.change({ title: 'Retired' });
  controller.dispose();
  await controller.create(ready);
  expect(calls).toBe(0);
});

test('late rejection cannot release another saved draft even when its attempt key matches', async () => {
  const gate = deferred<Issue>();
  const { controller, storage } = setup({ submit: () => gate.promise });
  controller.change({ title: 'Original' });
  const pending = controller.create(ready);
  controller.dispose();
  const newer = stored({ title: 'Newer text', attempt: {key: 'key-1', input: {title: 'Newer text', team_id: 'team-1'}} });
  storage.data.set(KEY, newer);
  gate.reject(new ApiError(422, 'INVALID', 'Rejected original'));
  await pending;
  expect(storage.data.get(KEY)).toBe(newer);
});
test('late success cannot delete changed draft text under the same attempt key', async () => {
  const gate = deferred<Issue>();
  const { controller, storage } = setup({ submit: () => gate.promise });
  controller.change({ title: 'Original' });
  const pending = controller.create(ready);
  const saved = JSON.parse(storage.data.get(KEY)!);
  const newer = JSON.stringify({...saved, description: 'New notes from another owner'});
  storage.data.set(KEY, newer);
  controller.dispose();
  gate.resolve(syntheticIssue(3));
  await pending;
  expect(storage.data.get(KEY)).toBe(newer);
});
