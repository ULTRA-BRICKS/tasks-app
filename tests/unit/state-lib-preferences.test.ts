import { test, expect } from 'bun:test';
import { createStore } from 'zustand/vanilla';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createPreferenceStore, type Preferences } from '../../src/features/preferences/model';
import type { usePreferences as useBaselinePreferences } from '../../src/features/preferences/baseline';
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const contractsMatch: Equal<
  Preferences,
  ReturnType<(typeof useBaselinePreferences)['getState']>
> = true;
const storage = (value: string | null = null) => ({
  getItem: (key = 'tickets-ui') => {
    expect(key).toBe('tickets-ui');
    return value;
  },
  setItem: (key: string, next: string) => {
    expect(key).toBe('tickets-ui');
    value = next;
  },
  removeItem: () => {
    value = null;
  },
});

test('state-lib preserves existing preference storage and transient sidebar semantics', () => {
  const disk = storage(JSON.stringify({ state: { theme: 'light', view: 'board' }, version: 0 }));
  const store = createPreferenceStore(disk);
  expect(store.getSnapshot().theme).toBe('light');
  expect(store.getSnapshot().view).toBe('board');
  expect(store.getSnapshot().sidebarOpen).toBe(false);
  let count = 0;
  const stop = store.subscribe(() => count++);
  store.getSnapshot().setSidebarOpen(true);
  store.getSnapshot().setTheme('dark');
  expect(count).toBe(2);
  expect(JSON.parse(disk.getItem()!)).toEqual({
    state: { view: 'board', theme: 'dark', density: 'auto' },
    version: 0,
  });
  stop();
  store.dispose();
  const reloaded = createPreferenceStore(disk);
  expect(reloaded.getSnapshot().sidebarOpen).toBe(false);
  reloaded.dispose();
});
test('1500 mixed UI updates match the current Zustand preference contract', () => {
  const a = storage(),
    b = storage();
  const original = createStore<{
    view: 'list' | 'board';
    theme: 'dark' | 'light';
    density: 'auto' | 'compact' | 'comfortable';
    sidebarOpen: boolean;
  }>()(
    persist(
      (): {
        view: 'list' | 'board';
        theme: 'dark' | 'light';
        density: 'auto' | 'compact' | 'comfortable';
        sidebarOpen: boolean;
      } => ({
        view: 'list',
        theme: 'dark',
        density: 'auto',
        sidebarOpen: false,
      }),
      {
        name: 'tickets-ui',
        storage: createJSONStorage(() => a),
        partialize: ({ view, theme, density }) => ({ view, theme, density }),
      },
    ),
  );
  const pilot = createPreferenceStore(b);
  for (let n = 0; n < 1500; n++) {
    if (n % 4 === 0) {
      const view = n % 2 ? 'list' : 'board';
      original.setState({ view });
      pilot.getSnapshot().setView(view);
    } else if (n % 4 === 1) {
      const theme = n % 2 ? 'dark' : 'light';
      original.setState({ theme });
      pilot.getSnapshot().setTheme(theme);
    } else if (n % 4 === 2) {
      const density = n % 2 ? 'compact' : 'comfortable';
      original.setState({ density });
      pilot.getSnapshot().setDensity(density);
    } else {
      const sidebarOpen = !!(n % 2);
      original.setState({ sidebarOpen });
      pilot.getSnapshot().setSidebarOpen(sidebarOpen);
    }
    const current = pilot.getSnapshot();
    expect({
      view: current.view,
      theme: current.theme,
      density: current.density,
      sidebarOpen: current.sidebarOpen,
    }).toEqual(original.getState());
  }
  expect(JSON.parse(b.getItem()!)).toEqual(JSON.parse(a.getItem()!));
  pilot.dispose();
});
test('corrupt or failing storage cannot lose the current in-memory preference', () => {
  const broken = createPreferenceStore(storage('{not json'));
  expect(broken.getSnapshot().theme).toBe('dark');
  broken.dispose();
  const denied = createPreferenceStore({
    getItem: () => null,
    setItem: () => {
      throw Error('quota');
    },
  });
  denied.getSnapshot().setTheme('light');
  expect(denied.getSnapshot().theme).toBe('light');
  expect(denied.getStorageError()).toBeInstanceOf(Error);
  denied.dispose();
});

test('pilot does not hydrate a future storage version as if it were version zero', () => {
  const persisted = JSON.stringify({ state: { view: 'board', theme: 'light' }, version: 9 });
  const disk = storage(persisted),
    controller = createPreferenceStore(disk);
  expect(controller.getSnapshot().view).toBe('list');
  expect(controller.getSnapshot().theme).toBe('dark');
  expect(disk.getItem()).toBe(persisted);
  controller.dispose();
});

test('current-main density persists, hydrates and rejects unknown choices', () => {
  const disk = storage(JSON.stringify({ state: { density: 'comfortable' }, version: 0 }));
  const store = createPreferenceStore(disk);
  expect(store.getSnapshot().density).toBe('comfortable');
  store.getSnapshot().setDensity('compact');
  expect(JSON.parse(disk.getItem()!).state.density).toBe('compact');
  store.dispose();
  const next = createPreferenceStore(disk);
  expect(next.getSnapshot().density).toBe('compact');
  next.dispose();
  const invalid = createPreferenceStore(
    storage(JSON.stringify({ state: { density: 'huge' }, version: 0 })),
  );
  expect(invalid.getSnapshot().density).toBe('auto');
  invalid.dispose();
});

test('the entire baseline and pilot preference type contracts match', () => {
  expect(contractsMatch).toBe(true);
});
test('subscription is cold and no-op writes do not overwrite persisted state', () => {
  let writes = 0,
    notifications = 0;
  const store = createPreferenceStore({
    getItem: () => null,
    setItem: () => {
      writes++;
    },
  });
  const stop = store.subscribe(() => notifications++);
  expect(writes).toBe(0);
  expect(notifications).toBe(0);
  store.getSnapshot().setTheme('dark');
  expect(writes).toBe(0);
  expect(notifications).toBe(0);
  store.getSnapshot().setTheme('light');
  expect(writes).toBe(1);
  expect(notifications).toBe(1);
  stop();
  store.dispose();
});
