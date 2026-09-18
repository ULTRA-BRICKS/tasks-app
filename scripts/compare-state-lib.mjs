import { createStore } from 'zustand/vanilla';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createPreferenceStore } from '../src/features/preferences/model.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

function create(backend) {
  let writes = 0;
  const storage = {
    getItem: () => null,
    setItem: () => {
      writes++;
    },
    removeItem: () => {},
  };
  if (backend === 'state-lib')
    return {
      store: createPreferenceStore(storage),
      writes: () => writes,
      reset: () => {
        writes = 0;
      },
    };
  const value = createStore()(
    persist(
      (set) => ({
        view: 'list',
        theme: 'dark',
        sidebarOpen: false,
        setView: (view) => set({ view }),
        setTheme: (theme) => set({ theme }),
        setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      }),
      {
        name: 'tickets-ui',
        storage: createJSONStorage(() => storage),
        partialize: ({ view, theme }) => ({ view, theme }),
      },
    ),
  );
  return {
    store: { getSnapshot: value.getState, subscribe: value.subscribe, dispose: () => {} },
    writes: () => writes,
    reset: () => {
      writes = 0;
    },
  };
}
function measure(backend, scenario, operations) {
  const { store, writes, reset } = create(backend);
  let notifications = 0;
  const stop = store.subscribe(() => notifications++);
  for (let n = 0; n < 1000; n++) store.getSnapshot().setTheme(n % 2 ? 'dark' : 'light');
  notifications = 0;
  reset();
  const start = performance.now();
  for (let n = 0; n < operations; n++)
    store.getSnapshot().setTheme(scenario === 'no-op' ? 'dark' : n % 2 ? 'dark' : 'light');
  const ms = performance.now() - start;
  const result = { backend, scenario, operations, ms, notifications, storageWrites: writes() };
  stop();
  store.dispose();
  return result;
}
const trials = [];
for (let trial = 0; trial < 7; trial++) {
  for (const scenario of ['changed', 'no-op']) {
    for (const backend of trial % 2 ? ['state-lib', 'baseline'] : ['baseline', 'state-lib']) {
      trials.push({ trial, ...measure(backend, scenario, 20000) });
    }
  }
}
const summary = [];
for (const scenario of ['changed', 'no-op'])
  for (const backend of ['baseline', 'state-lib']) {
    const rows = trials.filter((r) => r.backend === backend && r.scenario === scenario);
    const timings = rows.map((r) => r.ms).sort((a, b) => a - b);
    summary.push({
      backend,
      scenario,
      operations: rows[0].operations,
      medianMs: +timings[3].toFixed(3),
      minMs: +timings[0].toFixed(3),
      maxMs: +timings.at(-1).toFixed(3),
      notifications: rows[0].notifications,
      storageWrites: rows[0].storageWrites,
    });
  }
const result = {
  environment: {
    runtime: process.versions.bun ? `Bun ${process.versions.bun}` : process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  scope:
    'Preference-controller microbenchmark with equivalent JSON persistence, not full-app rendering or network performance.',
  caveat:
    'The pilot adapter explicitly suppresses no-op writes; the same optimization could be added to Zustand. Both real browser branches retain identical UI and server-state behavior.',
  summary,
  trials,
};
console.log(JSON.stringify(result, null, 2));
if (process.argv[2]) {
  mkdirSync(process.argv[2], { recursive: true });
  writeFileSync(`${process.argv[2]}/tasks-comparison.json`, JSON.stringify(result, null, 2) + '\n');
}
