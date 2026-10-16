import { expect, test } from 'bun:test';
import {
  createDraftPersistence,
  type DraftPorts,
  type DraftStorage,
  type DraftStorageEvent,
} from '../../src/shared/lib/draft-persistence';
import { createScopedDraftPersistence } from '../../src/shared/lib/draft-persistence-scope';
import { createScope } from '../../src/shared/lib/state/scope';

const owner = { workspace_id: 'w1', id: 'u1' };
const key = ['ticket-new', 'w1', 'u1', 'issue'].map(encodeURIComponent).join(':');
const other = ['ticket-new', 'w1', 'u2', 'issue'].map(encodeURIComponent).join(':');

function memoryStorage(fail?: { set?: boolean }): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (name) => map.get(name) ?? null,
    setItem: (name, value) => {
      if (fail?.set) throw new Error('quota');
      map.set(name, value);
    },
    removeItem: (name) => void map.delete(name),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}
function fakeWindow() {
  const handlers = new Set<(event: DraftStorageEvent) => void>();
  return {
    handlers,
    emit: (event: DraftStorageEvent) => handlers.forEach((handler) => handler(event)),
    storageEvents: (handler: (event: DraftStorageEvent) => void) => {
      handlers.add(handler);
      return () => void handlers.delete(handler);
    },
  };
}
function ports(overrides: Partial<DraftPorts> = {}) {
  const local = memoryStorage(),
    session = memoryStorage(),
    win = fakeWindow();
  return {
    local,
    session,
    win,
    ports: { local, session, storageEvents: win.storageEvents, ...overrides },
  };
}

test('instances own their memory, index, revision and listeners independently', () => {
  const a = ports(),
    b = ports();
  const first = createDraftPersistence({ ...a.ports, writerId: 'a' });
  const second = createDraftPersistence({ ...b.ports, writerId: 'b' });
  let heard = 0;
  second.subscribe(() => heard++);
  first.setItem(key, 'only in A');
  expect(first.getItem(key)).toBe('only in A');
  expect(second.getItem(key)).toBeNull();
  expect(second.list(owner)).toEqual([]);
  expect(first.list(owner).map((item) => item.value)).toEqual(['only in A']);
  expect(first.getSnapshot()).toBeGreaterThan(0);
  expect(second.getSnapshot()).toBe(0);
  expect(first.writerId).not.toBe(second.writerId);
  expect(heard).toBe(0);
});

test('retained input of one instance is invisible to another account-scoped instance', () => {
  const one = ports(),
    two = ports();
  const first = createDraftPersistence(one.ports);
  const second = createDraftPersistence(two.ports);
  first.setItem(key, 'private text');
  first.setItem(other, 'someone else');
  expect(first.list({ workspace_id: 'w1', id: 'u2' }).map((item) => item.value)).toEqual([
    'someone else',
  ]);
  expect(second.hasLocalCopies(owner)).toBe(false);
  expect([...two.local.map.values(), ...two.session.map.values()]).toEqual([]);
  second.setItem(key, 'second text');
  expect(first.getItem(key)).toBe('private text');
  expect(second.getItem(key)).toBe('second text');
});

test('dispose removes the window listener, listeners and caches; connect is idempotent', async () => {
  const env = ports();
  const store = createDraftPersistence(env.ports);
  const stop = store.connect();
  store.connect();
  expect(env.win.handlers.size).toBe(1);
  let heard = 0;
  store.subscribe(() => heard++);
  store.setItem(key, 'text');
  store.list(owner);
  store.dispose();
  expect(env.win.handlers.size).toBe(0);
  expect(store.disposed).toBe(true);
  expect(store.getItem(key)).toBeNull();
  expect(store.list(owner)).toEqual([]);
  await Promise.resolve();
  expect(heard).toBe(0);
  stop();
  store.dispose();
  store.connect();
  expect(env.win.handlers.size).toBe(0);
});

test('a late acknowledgement from a disposed instance cannot write another owner', () => {
  const shared = ports();
  const first = createDraftPersistence({ ...shared.ports, writerId: 'first' });
  first.setItem(key, 'sent text');
  const proof = first.capture(key)!;
  first.dispose();
  const second = createDraftPersistence({ ...shared.ports, writerId: 'second' });
  expect(second.getItem(key)).toBe('sent text');
  const before = [...shared.local.map.entries()];
  first.acknowledge(proof);
  first.removeItem(key);
  first.setItem(key, 'late edit');
  expect([...shared.local.map.entries()]).toEqual(before);
  expect(second.getItem(key)).toBe('sent text');
  expect(second.list(owner).map((item) => item.value)).toEqual(['sent text']);
  // The live owner still settles its own acknowledgement exactly.
  second.acknowledge(second.capture(key)!);
  expect(second.getItem(key)).toBeNull();
});

test('a failed durable write keeps the text recoverable and reports the warning', async () => {
  const session = memoryStorage(),
    local = memoryStorage({ set: true });
  const store = createDraftPersistence({ local, session, writerId: 'tab' });
  store.setItem(key, 'precious');
  expect(store.getItem(key)).toBe('precious');
  expect(store.warnings(owner).map(([name]) => name)).toEqual([key]);
  expect(store.list(owner).map((item) => item.value)).toEqual(['precious']);
  const reopened = createDraftPersistence({ local, session, writerId: 'reopened' });
  expect(reopened.getItem(key)).toBe('precious');
  const nothing = createDraftPersistence({
    local,
    session: memoryStorage({ set: true }),
    writerId: 'nothing',
  });
  expect(() => nothing.setItem(key, 'memory only')).toThrow('Draft remains only in page memory');
  expect(nothing.getItem(key)).toBe('memory only');
  expect(nothing.list(owner).map((item) => item.value)).toEqual(['memory only']);
});

test('cross-tab merge: a remote durable write is indexed, active edits are not replaced', () => {
  const env = ports();
  const store = createDraftPersistence({ ...env.ports, writerId: 'here' });
  store.connect();
  const remote = createDraftPersistence({
    local: env.local,
    session: memoryStorage(),
    writerId: 'there',
  });
  remote.setItem(key, 'from another tab');
  const [name, value] = [...env.local.map.entries()].find(([n]) => n.endsWith(':there'))!;
  let heard = 0;
  store.subscribe(() => heard++);
  env.win.emit({ key: name, newValue: value });
  expect(store.list(owner).map((item) => item.value)).toEqual(['from another tab']);
  store.setItem(key, 'my active edit');
  env.win.emit({ key: name, newValue: value });
  expect(store.getItem(key)).toBe('my active edit');
  env.win.emit({ key: name, newValue: null });
  expect(store.list(owner).map((item) => item.value)).toEqual(['my active edit']);
  return Promise.resolve().then(() => expect(heard).toBeGreaterThan(0));
});

test('scope ownership: revision is a scope value and scope disposal releases the store', () => {
  const env = ports();
  const scope = createScope();
  const store = createScopedDraftPersistence(scope, env.ports);
  const stop = store.connect();
  expect(env.win.handlers.size).toBe(1);
  const before = store.getSnapshot();
  store.setItem(key, 'scoped');
  expect(store.getSnapshot()).toBe(before + 1);
  const proof = store.capture(key)!;
  scope.dispose();
  expect(store.disposed).toBe(true);
  expect(env.win.handlers.size).toBe(0);
  const durable = [...env.local.map.entries()];
  store.acknowledge(proof);
  expect([...env.local.map.entries()]).toEqual(durable);
  stop();
});

test('factory construction and draft writes work without secure-context randomUUID', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID');
  try {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: undefined,
      configurable: true,
    });
    const env = ports();
    const first = createDraftPersistence(env.ports);
    const second = createDraftPersistence(env.ports);
    expect(first.writerId).not.toBe(second.writerId);
    first.setItem(key, 'Recovered on a LAN preview');
    expect(first.getItem(key)).toBe('Recovered on a LAN preview');
    first.dispose();
    second.dispose();
  } finally {
    if (descriptor) Object.defineProperty(globalThis.crypto, 'randomUUID', descriptor);
    else Reflect.deleteProperty(globalThis.crypto, 'randomUUID');
  }
});
