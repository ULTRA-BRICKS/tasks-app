import { test, expect } from 'bun:test';
import { createDocumentController } from '../../src/features/issue-edit/document-controller';
import type { ServerDocument } from '../../src/shared/lib/draft';
const initial: ServerDocument = { title: 'Original', description: 'Body', version: 1 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function disk() {
  let value: string | null = null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    removeItem: () => {
      value = null;
    },
  };
}
test('document changes publish one coherent snapshot and persist the existing envelope', () => {
  const storage = disk();
  const store = createDocumentController({
    initial,
    storageKey: 'draft',
    storage,
    save: async (sent) => sent,
  });
  const seen: boolean[] = [];
  const before = store.getSnapshot();
  const stop = store.subscribe(() => seen.push(store.getSnapshot().dirty));
  store.change('title', 'Edited');
  expect(seen).toEqual([true]);
  expect(before.draft.title).toBe('Original');
  expect(JSON.parse(storage.getItem()!).title).toBe('Edited');
  expect(Object.isFrozen(store.getSnapshot().draft)).toBe(true);
  stop();
  store.dispose();
});
test('typing during a delayed save is preserved and flush drains the later revision', async () => {
  const pending = deferred<ServerDocument>();
  const sent: string[] = [];
  const storage = disk();
  const store = createDocumentController({
    initial,
    storageKey: 'draft',
    storage,
    save: async (value) => {
      sent.push(value.title);
      return sent.length === 1 ? pending.promise : { ...value, version: 3 };
    },
  });
  store.change('title', 'First');
  const flushing = store.flush();
  expect(store.getSnapshot().busy).toBe(true);
  store.change('title', 'Second');
  pending.resolve({ ...initial, title: 'First', version: 2 });
  await flushing;
  expect(sent).toEqual(['First', 'Second']);
  expect(store.getSnapshot().draft.title).toBe('Second');
  expect(store.getSnapshot().dirty).toBe(false);
  expect(storage.getItem()).toBe(null);
  store.dispose();
});
test('older write acknowledgements never replace a newer observed document', async () => {
  const pending = deferred<ServerDocument>();
  const store = createDocumentController({
    initial,
    storageKey: 'draft',
    save: () => pending.promise,
  });
  store.change('title', 'First');
  const saving = store.commit();
  store.change('title', 'Second');
  store.observe({ ...initial, title: 'First', version: 3 });
  pending.resolve({ ...initial, title: 'First', version: 2 });
  await saving;
  expect(store.getSnapshot().draft.title).toBe('Second');
  expect(store.getSnapshot().draft.version).toBe(3);
  expect(store.getSnapshot().dirty).toBe(true);
  store.dispose();
});
test('conflict stops retry until explicit resolution and retains local text', async () => {
  const remote = { ...initial, title: 'Remote', version: 5 };
  let calls = 0;
  const store = createDocumentController({
    initial,
    storageKey: 'draft',
    conflictFrom: () => remote,
    save: async (sent) => {
      if (++calls === 1) throw Error('conflict');
      return { ...sent, version: 6 };
    },
  });
  store.change('title', 'Local');
  await store.commit();
  expect(store.getSnapshot().conflict).toEqual(remote);
  expect(store.getSnapshot().draft.title).toBe('Local');
  await store.retry();
  expect(calls).toBe(1);
  await store.resolveConflict();
  expect(calls).toBe(2);
  expect(store.getSnapshot().dirty).toBe(false);
  expect(store.getSnapshot().draft.title).toBe('Local');
  store.dispose();
});
test('storage failures are observable without discarding in-memory edits', () => {
  const store = createDocumentController({
    initial,
    storageKey: 'draft',
    save: async (sent) => sent,
    storage: {
      getItem: () => null,
      setItem: () => {
        throw Error('quota');
      },
      removeItem: () => {},
    },
  });
  store.change('description', 'Important');
  expect(store.getSnapshot().draft.description).toBe('Important');
  expect(store.getSnapshot().storageError).toBe(true);
  store.dispose();
});
test('disposal revokes late completion and cannot erase a retained draft', async () => {
  const pending = deferred<ServerDocument>(),
    storage = disk();
  const store = createDocumentController({
    initial,
    storageKey: 'draft',
    storage,
    save: () => pending.promise,
  });
  store.change('title', 'Keep me');
  const saving = store.commit();
  const saved = storage.getItem();
  store.dispose();
  pending.resolve({ ...initial, title: 'Keep me', version: 2 });
  expect(await saving).toBe(null);
  expect(storage.getItem()).toBe(saved);
});
test('StrictMode cleanup/setup revokes old work but keeps the reactivated scope usable', async () => {
  const pending = deferred<ServerDocument>(),
    storage = disk();
  let calls = 0;
  const store = createDocumentController({
    initial,
    storageKey: 'draft',
    storage,
    save: async (sent) => (++calls === 1 ? pending.promise : { ...sent, version: 3 }),
  });
  store.change('title', 'Old');
  const oldSave = store.commit();
  store.deactivate();
  store.activate();
  await Promise.resolve();
  store.change('title', 'New');
  pending.resolve({ ...initial, title: 'Old', version: 2 });
  await oldSave;
  expect(store.getSnapshot().draft.title).toBe('New');
  expect(store.getSnapshot().dirty).toBe(true);
  await store.flush();
  expect(store.getSnapshot().draft.title).toBe('New');
  expect(store.getSnapshot().busy).toBe(false);
  store.dispose();
});
test('focused editor preserves its text until editing ends, then observes remote content', () => {
  const store = createDocumentController({
    initial,
    storageKey: 'draft',
    save: async (sent) => sent,
  });
  store.beginEdit();
  store.observe({ ...initial, title: 'Remote', version: 2 });
  expect(store.getSnapshot().draft.title).toBe('Original');
  store.endEdit();
  expect(store.getSnapshot().draft.title).toBe('Remote');
  store.dispose();
});
test('reopening restores an unsent draft and discard restores current server document', () => {
  const storage = disk();
  const first = createDocumentController({
    initial,
    storageKey: 'draft',
    storage,
    save: async (sent) => sent,
  });
  first.change('title', 'Unsent');
  first.dispose();
  const second = createDocumentController({
    initial,
    storageKey: 'draft',
    storage,
    save: async (sent) => sent,
  });
  expect(second.getSnapshot().draft.title).toBe('Unsent');
  second.discard();
  expect(second.getSnapshot().draft.title).toBe('Original');
  expect(storage.getItem()).toBe(null);
  second.dispose();
});

test('unchanged or older server versions stop the drain and keep the unsent draft', async () => {
  for (const version of [0, 1]) {
    const storage = disk();
    const store = createDocumentController({
      initial,
      storageKey: 'draft',
      storage,
      save: async (sent) => ({ ...sent, version }),
    });
    store.change('title', 'Keep');
    expect(await store.flush()).toBe(null);
    expect(store.getSnapshot().dirty).toBe(true);
    expect(store.getSnapshot().busy).toBe(false);
    expect(store.getSnapshot().error).toContain('advance');
    expect(storage.getItem()).not.toBe(null);
    store.dispose();
  }
});
test('discard during an active save cannot erase a newer in-memory edit', async () => {
  const waiting = deferred<ServerDocument>();
  const store = createDocumentController({
    initial,
    storageKey: 'draft',
    save: () => waiting.promise,
  });
  store.change('title', 'Sent');
  const pending = store.commit();
  store.change('title', 'Later');
  store.discard();
  expect(store.getSnapshot().draft.title).toBe('Later');
  waiting.resolve({ ...initial, title: 'Sent', version: 2 });
  await pending;
  expect(store.getSnapshot().draft.title).toBe('Later');
  expect(store.getSnapshot().dirty).toBe(true);
  store.dispose();
});
test('disposal attempted during notification does not poison subsequent controller cleanup', () => {
  const store = createDocumentController({
    initial,
    storageKey: 'draft',
    save: async (sent) => sent,
  });
  const stop = store.subscribe(() => store.dispose());
  expect(() => store.change('title', 'Committed')).toThrow();
  stop();
  expect(store.getSnapshot().draft.title).toBe('Committed');
  expect(() => store.dispose()).not.toThrow();
  expect(() => store.getSnapshot()).toThrow();
});
