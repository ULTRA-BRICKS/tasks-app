import { Runtime, toExternalStore } from '@ultrabricks/state-lib';

export type Preferences = {
  view: 'list' | 'board';
  theme: 'dark' | 'light';
  density: 'auto' | 'compact' | 'comfortable';
  setDensity: (density: 'auto' | 'compact' | 'comfortable') => void;
  sidebarOpen: boolean;
  setView: (view: 'list' | 'board') => void;
  setTheme: (theme: 'dark' | 'light') => void;
  setSidebarOpen: (open: boolean) => void;
};
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
const defaults = { view: 'list', theme: 'dark', density: 'auto', sidebarOpen: false } as const;

/** Pilot replaces only the UI preference store, not TanStack Query or URL state. */
export function createPreferenceStore(storage?: StoragePort) {
  const runtime = new Runtime();
  let saved: Partial<Pick<Preferences, 'view' | 'theme' | 'density'>> = {};
  try {
    const envelope: unknown = JSON.parse(storage?.getItem('tickets-ui') ?? 'null');
    if (
      envelope &&
      typeof envelope === 'object' &&
      'state' in envelope &&
      (!('version' in envelope) || typeof envelope.version !== 'number' || envelope.version === 0)
    ) {
      const state = envelope.state as Partial<Preferences> | null;
      if (state?.view === 'list' || state?.view === 'board') saved.view = state.view;
      if (state?.theme === 'dark' || state?.theme === 'light') saved.theme = state.theme;
      if (
        state?.density === 'auto' ||
        state?.density === 'compact' ||
        state?.density === 'comfortable'
      )
        saved.density = state.density;
    }
  } catch {
    /* Unavailable/corrupt storage cannot prevent the app from opening. */
  }
  const patch = (
    value: Partial<Pick<Preferences, 'view' | 'theme' | 'density' | 'sidebarOpen'>>,
  ) => {
    const previous = state.get();
    if (
      Object.entries(value).every(([key, next]) =>
        Object.is(previous[key as keyof Preferences], next),
      )
    )
      return;
    state.set({ ...previous, ...value });
  };
  const state = runtime.signal<Preferences>({
    ...defaults,
    ...saved,
    setView: (view) => patch({ view }),
    setTheme: (theme) => patch({ theme }),
    setDensity: (density) => patch({ density }),
    setSidebarOpen: (sidebarOpen) => patch({ sidebarOpen }),
  });
  let storageError: unknown;
  state.subscribe(({ view, theme, density }) => {
    try {
      storage?.setItem(
        'tickets-ui',
        JSON.stringify({ state: { view, theme, density }, version: 0 }),
      );
      storageError = undefined;
    } catch (error) {
      storageError = error;
    }
  });
  return Object.freeze({
    ...toExternalStore(state),
    getStorageError: () => storageError,
    dispose: () => runtime.dispose(),
  });
}
