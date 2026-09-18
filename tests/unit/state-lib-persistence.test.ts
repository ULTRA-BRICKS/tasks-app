import { test, expect } from 'bun:test';
import { createPreferenceStore } from '../../src/features/preferences/model';
function environment() {
  let value: string | null = null,
    fail = false,
    writes = 0;
  let listener: ((value: string | null) => void) | undefined;
  return {
    storage: {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        if (fail) throw Error('quota');
        value = next;
        writes++;
      },
    },
    listen: (next: (value: string | null) => void) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    emit: (next: string | null) => {
      value = next;
      listener?.(next);
    },
    setFailure: (next: boolean) => {
      fail = next;
    },
    writes: () => writes,
    listening: () => !!listener,
  };
}
const envelope = (theme: string, version = 0) =>
  JSON.stringify({ state: { view: 'list', theme, density: 'auto' }, version });
test('storage events update compatible state without an echo write', () => {
  const env = environment();
  const store = createPreferenceStore(env.storage, env.listen);
  env.emit(envelope('light'));
  expect(store.getSnapshot().theme).toBe('light');
  expect(env.writes()).toBe(0);
  store.dispose();
  expect(env.listening()).toBe(false);
});
test('future storage event revokes writer authority until a compatible external replacement', () => {
  const env = environment();
  const store = createPreferenceStore(env.storage, env.listen);
  env.emit(envelope('light', 9));
  store.getSnapshot().setTheme('light');
  expect(env.writes()).toBe(0);
  expect(store.getPersistenceSnapshot().kind).toBe('unsupported-version');
  env.emit(envelope('dark'));
  expect(store.getSnapshot().theme).toBe('light');
  expect(store.getPersistenceSnapshot().kind).toBe('conflict');
  // Compatible data restores the possible write path, not permission to erase
  // an unsaved local choice; the user explicitly retries that choice.
  store.retryPersistence();
  expect(env.writes()).toBe(1);
  store.dispose();
});
test('failed local persistence is not silently overwritten by a remote tab', () => {
  const env = environment();
  const store = createPreferenceStore(env.storage, env.listen);
  env.setFailure(true);
  store.getSnapshot().setTheme('light');
  expect(store.getPersistenceSnapshot().kind).toBe('write-error');
  env.emit(envelope('dark'));
  expect(store.getSnapshot().theme).toBe('light');
  expect(store.getPersistenceSnapshot().kind).toBe('conflict');
  env.setFailure(false);
  store.retryPersistence();
  expect(store.getPersistenceSnapshot().kind).toBe('ready');
  expect(JSON.parse(env.storage.getItem()!).state.theme).toBe('light');
  store.dispose();
});
test('read and parse errors have distinct observable status', () => {
  const unreadable = createPreferenceStore({
    getItem: () => {
      throw Error('blocked');
    },
    setItem: () => {},
  });
  expect(unreadable.getPersistenceSnapshot().kind).toBe('read-error');
  unreadable.dispose();
  const malformed = createPreferenceStore({ getItem: () => '{bad', setItem: () => {} });
  expect(malformed.getPersistenceSnapshot().kind).toBe('invalid-data');
  malformed.dispose();
});
test('persistence status and preference values publish coherently on quota failure', () => {
  const env = environment();
  const store = createPreferenceStore(env.storage, env.listen);
  const seen: string[] = [];
  const stop = store.subscribe(() =>
    seen.push(`${store.getSnapshot().theme}:${store.getPersistenceSnapshot().kind}`),
  );
  env.setFailure(true);
  store.getSnapshot().setTheme('light');
  expect(seen).toEqual(['light:write-error']);
  stop();
  store.dispose();
});
test('a future version written before a delayed storage event is still not overwritten', () => {
  const env = environment();
  const store = createPreferenceStore(env.storage);
  env.emit(envelope('dark', 4));
  store.getSnapshot().setTheme('light');
  expect(env.writes()).toBe(0);
  expect(JSON.parse(env.storage.getItem()!).version).toBe(4);
  store.dispose();
});

test('a compatible external event does not erase a local choice blocked by a future schema', () => {
  const env = environment();
  const store = createPreferenceStore(env.storage, env.listen);
  env.emit(envelope('dark', 8));
  store.getSnapshot().setTheme('light');
  env.emit(envelope('dark'));
  expect(store.getSnapshot().theme).toBe('light');
  expect(store.getPersistenceSnapshot().kind).toBe('conflict');
  expect(env.writes()).toBe(0);
  store.retryPersistence();
  expect(JSON.parse(env.storage.getItem()!).state.theme).toBe('light');
  expect(store.getPersistenceSnapshot().kind).toBe('ready');
  store.dispose();
});
