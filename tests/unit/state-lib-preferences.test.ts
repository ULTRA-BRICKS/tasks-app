import { test, expect } from 'bun:test';
import { createStore } from 'zustand/vanilla';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createPreferenceStore } from '../../src/features/preferences/model';
const storage = (value: string | null = null) => ({
  getItem: () => value,
  setItem: (_key: string, next: string) => {
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
    state: { view: 'board', theme: 'dark' },
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
    sidebarOpen: boolean;
  }>()(
    persist(
      (): { view: 'list' | 'board'; theme: 'dark' | 'light'; sidebarOpen: boolean } => ({
        view: 'list',
        theme: 'dark',
        sidebarOpen: false,
      }),
      {
        name: 'tickets-ui',
        storage: createJSONStorage(() => a),
        partialize: ({ view, theme }) => ({ view, theme }),
      },
    ),
  );
  const pilot = createPreferenceStore(b);
  for (let n = 0; n < 1500; n++) {
    if (n % 3 === 0) {
      const view = n % 2 ? 'list' : 'board';
      original.setState({ view });
      pilot.getSnapshot().setView(view);
    } else if (n % 3 === 1) {
      const theme = n % 2 ? 'dark' : 'light';
      original.setState({ theme });
      pilot.getSnapshot().setTheme(theme);
    } else {
      const sidebarOpen = !!(n % 2);
      original.setState({ sidebarOpen });
      pilot.getSnapshot().setSidebarOpen(sidebarOpen);
    }
    const current = pilot.getSnapshot();
    expect({ view: current.view, theme: current.theme, sidebarOpen: current.sidebarOpen }).toEqual(
      original.getState(),
    );
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
