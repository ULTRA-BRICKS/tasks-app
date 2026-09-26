import { expect, test } from 'bun:test';
import type { Issue, IssueCreate } from '@tickets/contracts';
import { ApiError } from '../../src/shared/api/client';
import { createIssueDraftController } from '../../src/pages/issue-new/draft-controller';
import { newIssueDraft } from '../../src/pages/issue-new/model';
import { deferred, memoryStorage, syntheticIssue } from '../fixtures/state-migration';

const KEY = 'ticket-new:ws-1:user-1:issue::::::::';
function setup(over: Partial<Parameters<typeof createIssueDraftController>[0]> = {}) {
  let counter = 0;
  const storage = memoryStorage();
  const submitted: Array<{ key: string; input: IssueCreate }> = [];
  const created: Array<{ issue: Issue; mounted: boolean }> = [];
  const controller = createIssueDraftController({
    key: KEY,
    incoming: {},
    storage,
    submit: (attempt) => {
      submitted.push(attempt);
      return Promise.resolve(syntheticIssue(9));
    },
    onCreated: (issue, mounted) => void created.push({ issue, mounted }),
    describeError: (error) => (error instanceof Error ? error.message : String(error)),
    newKey: () => `key-${++counter}`,
    ...over,
  });
  return { controller, storage, submitted, created };
}
const ready = { team: 'team-1', status: 'status-todo', readOnly: false };

test('restores a valid stored draft and rejects malformed or oversized storage', () => {
  const good = newIssueDraft({ title: 'Kept' });
  const restored = setup({ storage: memoryStorage({ [KEY]: JSON.stringify(good) }) });
  expect(restored.controller.getSnapshot().draft.title).toBe('Kept');
  for (const bad of ['{', JSON.stringify({ ...good, title: 'x'.repeat(301) }), '{"title":1}']) {
    const store = setup({ storage: memoryStorage({ [KEY]: bad }) });
    expect(store.controller.getSnapshot().draft.title).toBe('');
  }
  const blocked = memoryStorage();
  blocked.flags.failReads = true;
  expect(setup({ storage: blocked }).controller.getSnapshot().storageError).toBe(false);
});

test('change publishes one snapshot, persists it, and records a storage failure without losing text', () => {
  const { controller, storage } = setup();
  let waves = 0;
  const stop = controller.subscribe(() => waves++);
  controller.change({ title: 'Hello' });
  expect(waves).toBe(1);
  expect(JSON.parse(storage.data.get(KEY)!).title).toBe('Hello');
  storage.flags.failWrites = true;
  controller.change({ title: 'Hello again' });
  expect(controller.getSnapshot().draft.title).toBe('Hello again');
  expect(controller.getSnapshot().storageError).toBe(true);
  stop();
  controller.dispose();
});

test('create persists the idempotency attempt before sending and clears the draft on success', async () => {
  const gate = deferred<Issue>();
  const sent: Array<{ key: string; input: IssueCreate }> = [];
  const { controller, storage, created } = setup({ submit: (a) => (sent.push(a), gate.promise) });
  controller.change({ title: '  Ship it ' });
  const running = controller.create(ready);
  expect(controller.getSnapshot().pending).toBe(true);
  expect(controller.getSnapshot().frozen).toBe(true);
  expect(JSON.parse(storage.data.get(KEY)!).attempt.key).toBe('key-1');
  expect(sent[0].input.title).toBe('Ship it');
  gate.resolve(syntheticIssue(9));
  await running;
  expect(storage.data.has(KEY)).toBe(false);
  expect(created).toEqual([{ issue: syntheticIssue(9), mounted: true }]);
  expect(controller.getSnapshot().pending).toBe(false);
  controller.dispose();
});

test('a second create while one is running is ignored (single submit lock)', async () => {
  const gate = deferred<Issue>();
  const sent: string[] = [];
  const { controller } = setup({ submit: (a) => (sent.push(a.key), gate.promise) });
  controller.change({ title: 'Once' });
  const first = controller.create(ready);
  await controller.create(ready);
  gate.resolve(syntheticIssue(1));
  await first;
  expect(sent).toEqual(['key-1']);
});

test('creation guards: viewers, missing team and blank titles never submit', async () => {
  const { controller, submitted } = setup();
  await controller.create(ready); // Blank title
  controller.change({ title: 'T' });
  await controller.create({ ...ready, readOnly: true });
  await controller.create({ ...ready, team: '' });
  expect(submitted).toEqual([]);
});

test('optimistic error contract: 4xx unfreezes, server/network/408/409 keep the attempt and its key', async () => {
  const outcomes: unknown[] = [
    new ApiError(422, 'INVALID', 'Bad title'),
    new ApiError(500, 'BOOM', 'Server error'),
    new ApiError(409, 'CONFLICT', 'Conflict'),
    new ApiError(408, 'TIMEOUT', 'Timeout'),
  ];
  const keys: string[] = [];
  const { controller } = setup({
    submit: (a) => {
      keys.push(a.key);
      return Promise.reject(outcomes.shift());
    },
  });
  controller.change({ title: 'Retry me' });
  await controller.create(ready);
  expect(controller.getSnapshot().draft.attempt).toBeUndefined();
  expect(controller.getSnapshot().error).toBe('Bad title');
  await controller.create(ready);
  expect(controller.getSnapshot().draft.attempt?.key).toBe('key-2');
  expect(controller.getSnapshot().frozen).toBe(true);
  await controller.create(ready);
  await controller.create(ready);
  expect(keys).toEqual(['key-1', 'key-2', 'key-2', 'key-2']); // Retries reuse one key.
});

test('cancellation: after disposal a success still clears the draft and reports it was unmounted', async () => {
  const gate = deferred<Issue>();
  const { controller, storage, created } = setup({ submit: () => gate.promise });
  controller.change({ title: 'Leaving' });
  const running = controller.create(ready);
  controller.dispose();
  gate.resolve(syntheticIssue(3));
  await running;
  expect(storage.data.has(KEY)).toBe(false);
  expect(created).toEqual([{ issue: syntheticIssue(3), mounted: false }]);
});

test('StrictMode replay does not revoke a running creation', async () => {
  const gate = deferred<Issue>();
  const { controller, created } = setup({ submit: () => gate.promise });
  controller.change({ title: 'Replay' });
  controller.scope.activate();
  const running = controller.create(ready);
  controller.scope.deactivate();
  controller.scope.activate();
  gate.resolve(syntheticIssue(4));
  await running;
  await Promise.resolve();
  expect(created[0].mounted).toBe(true);
  controller.dispose();
});

test('unsaved-work signal for the beforeunload guard follows title and description', () => {
  const { controller } = setup();
  expect(controller.hasUnsavedWork()).toBe(false);
  controller.change({ description: 'Notes' });
  expect(controller.hasUnsavedWork()).toBe(true);
});
