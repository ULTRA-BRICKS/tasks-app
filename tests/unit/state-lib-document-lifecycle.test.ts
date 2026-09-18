import { expect, spyOn, test } from 'bun:test';
import { NotificationError, Runtime, StateError } from '@ultrabricks/state-lib';
import { createDocumentController } from '../../src/features/issue-edit/document-controller';
import type { DocumentDraft, ServerDocument } from '../../src/shared/lib/draft';

const initial: ServerDocument = { title: 'Original', description: 'Body', version: 1 };
function memory() {
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
const saveNext = async (draft: DocumentDraft): Promise<ServerDocument> => ({
  ...draft,
  version: draft.version + 1,
});

test('rejected subscriber disposal preserves publication, sibling observers and later edits', () => {
  const storage = memory();
  const store = createDocumentController({ initial, storageKey: 'draft', storage, save: saveNext });
  const stopBad = store.subscribe(() => store.dispose());
  const seen: string[] = [];
  const stopSibling = store.subscribe(() => seen.push(store.getSnapshot().draft.title));
  let failure: unknown;
  try {
    store.change('title', 'Committed');
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(NotificationError);
  if (!(failure instanceof NotificationError))
    throw Error('Expected a committed notification failure');
  expect(failure.committed).toBe(true);
  expect(
    failure.errors.some(
      (error) => error instanceof StateError && error.code === 'STATE_DISPOSE_BOUNDARY',
    ),
  ).toBe(true);
  expect(seen).toEqual(['Committed']);
  expect(store.getSnapshot().draft.title).toBe('Committed');
  expect(JSON.parse(storage.getItem()!).title).toBe('Committed');
  stopBad();
  store.change('title', 'Still editable');
  expect(seen).toEqual(['Committed', 'Still editable']);
  store.dispose();
  expect(() => store.getSnapshot()).toThrow();
  expect(() => store.dispose()).not.toThrow();
  expect(() => stopSibling()).not.toThrow();
  expect(JSON.parse(storage.getItem()!).title).toBe('Still editable');
});

test('refused cleanup does not detach a pending save or lose its newer queued edit', async () => {
  let resolve!: (value: ServerDocument) => void;
  const pending = new Promise<ServerDocument>((yes) => {
    resolve = yes;
  });
  const sent: string[] = [];
  const storage = memory();
  const store = createDocumentController({
    initial,
    storageKey: 'draft',
    storage,
    save: async (draft) => {
      sent.push(draft.title);
      return sent.length === 1 ? pending : { ...draft, version: 3 };
    },
  });
  store.change('title', 'Sent');
  const first = store.commit();
  const stopBad = store.subscribe(() => store.dispose());
  expect(() => store.change('title', 'Newer')).toThrow(NotificationError);
  stopBad();
  expect(store.commit()).toBe(first);
  expect(store.getSnapshot().busy).toBe(true);
  resolve({ ...initial, title: 'Sent', version: 2 });
  await first;
  expect(sent).toEqual(['Sent', 'Newer']);
  expect(store.getSnapshot().draft.title).toBe('Newer');
  expect(store.getSnapshot().draft.version).toBe(3);
  expect(store.getSnapshot().busy).toBe(false);
  expect(store.getSnapshot().dirty).toBe(false);
  expect(storage.getItem()).toBe(null);
  store.dispose();
});

for (const boundary of ['transaction', 'derivation'] as const) {
  test(`refused ${boundary} disposal leaves controller authority and subscriptions intact`, () => {
    // Capture the actual owner with a call-through spy; run the real kernel guards.
    const probe = spyOn(Runtime.prototype, 'signal');
    let store: ReturnType<typeof createDocumentController<ServerDocument>>;
    let owner: Runtime;
    const storage = memory();
    try {
      store = createDocumentController({ initial, storageKey: 'draft', storage, save: saveNext });
      owner = probe.mock.contexts[0] as Runtime;
    } finally {
      probe.mockRestore();
    }
    const before = store.getSnapshot();
    const seen: string[] = [];
    const stop = store.subscribe(() => seen.push(store.getSnapshot().draft.title));
    const read = boundary === 'derivation' ? owner.derive(() => store.dispose()) : null;
    let failure: unknown;
    try {
      if (read) read.get();
      else owner.transaction(() => store.dispose());
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(StateError);
    if (!(failure instanceof StateError)) throw Error('Expected the real runtime boundary error');
    expect(failure.code).toBe('STATE_DISPOSE_BOUNDARY');
    expect(store.getSnapshot()).toBe(before);
    expect(storage.getItem()).toBe(null);
    expect(owner.version).toBe(0);
    expect(seen).toEqual([]);
    read?.dispose();
    store.change('title', 'Recovered');
    expect(seen).toEqual(['Recovered']);
    expect(JSON.parse(storage.getItem()!).title).toBe('Recovered');
    store.dispose();
    expect(() => store.getSnapshot()).toThrow();
    expect(() => store.dispose()).not.toThrow();
    expect(() => stop()).not.toThrow();
  });
}
