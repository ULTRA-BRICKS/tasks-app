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
type PersistedValues = Pick<Preferences, 'view' | 'theme' | 'density'>;
export type PersistenceKind =
  | 'ready'
  | 'unavailable'
  | 'read-error'
  | 'invalid-data'
  | 'unsupported-version'
  | 'write-error'
  | 'conflict';
export type PersistenceStatus = Readonly<{
  kind: PersistenceKind;
  message: string;
  unsaved: boolean;
}>;
const defaults = { view: 'list', theme: 'dark', density: 'auto', sidebarOpen: false } as const;
const ready: PersistenceStatus = Object.freeze({ kind: 'ready', message: '', unsaved: false });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function decode(raw: string | null): {
  values: PersistedValues;
  error?: Error;
  kind: PersistenceKind;
} {
  const values: PersistedValues = {
    view: defaults.view,
    theme: defaults.theme,
    density: defaults.density,
  };
  try {
    const envelope: unknown = JSON.parse(raw ?? 'null');
    if (envelope === null) return { values, kind: 'ready' };
    if (!isRecord(envelope)) throw Error('Saved preferences are not a supported object.');
    if (typeof envelope.version === 'number' && envelope.version !== 0)
      return {
        values,
        kind: 'unsupported-version',
        error: Object.assign(new Error('A different saved settings version was retained.'), {
          code: 'UNSUPPORTED_STORAGE_VERSION',
          version: envelope.version,
        }),
      };
    if (envelope.version !== undefined && envelope.version !== 0)
      throw Error('Saved settings have an invalid version.');
    if (!isRecord(envelope.state)) throw Error('Saved settings have an invalid state.');
    const data = envelope.state;
    if (data.view === 'list' || data.view === 'board') values.view = data.view;
    if (data.theme === 'dark' || data.theme === 'light') values.theme = data.theme;
    if (data.density === 'auto' || data.density === 'compact' || data.density === 'comfortable')
      values.density = data.density;
    return { values, kind: 'ready' };
  } catch (failure) {
    return {
      values,
      kind: 'invalid-data',
      error: failure instanceof Error ? failure : new Error(String(failure)),
    };
  }
}
const serialize = ({ view, theme, density }: PersistedValues) =>
  JSON.stringify({ state: { view, theme, density }, version: 0 });

/** One Runtime owns preference values and the observable persistence outcome. */
export function createPreferenceStore(
  storage?: StoragePort,
  listen?: (changed: (raw: string | null) => void) => () => void,
) {
  const runtime = new Runtime();
  function read() {
    if (!storage)
      return {
        ...decode(null),
        kind: 'unavailable' as const,
        error: new Error('Browser storage is unavailable.'),
      };
    try {
      return decode(storage.getItem('tickets-ui'));
    } catch (failure) {
      return {
        ...decode(null),
        kind: 'read-error' as const,
        error: failure instanceof Error ? failure : new Error(String(failure)),
      };
    }
  }
  const initial = read();
  let storageError: unknown = initial.error,
    closed = false;
  const statusOf = (kind: PersistenceKind, error?: unknown, unsaved = false): PersistenceStatus =>
    kind === 'ready'
      ? ready
      : Object.freeze({
          kind,
          message:
            error instanceof Error
              ? error.message
              : typeof error === 'string'
                ? error
                : 'Browser storage operation failed.',
          unsaved,
        });
  const status = runtime.signal<PersistenceStatus>(statusOf(initial.kind, initial.error));
  let persistedProjection = serialize(initial.values);
  function persist(next: Preferences, force = false): PersistenceStatus {
    const projection = serialize(next);
    if (!force && projection === persistedProjection) return status.get();
    const disk = read(); // Also protects against an external write whose event has not arrived.
    if (disk.kind !== 'ready') {
      storageError = disk.error;
      return statusOf(disk.kind, disk.error, true);
    }
    try {
      storage?.setItem('tickets-ui', projection);
      persistedProjection = projection;
      storageError = undefined;
      return ready;
    } catch (failure) {
      storageError = failure;
      return statusOf('write-error', failure, true);
    }
  }
  const patch = (
    value: Partial<Pick<Preferences, 'view' | 'theme' | 'density' | 'sidebarOpen'>>,
  ) => {
    if (closed) throw Error('Preference store is disposed');
    const previous = state.get();
    if (
      Object.entries(value).every(([key, next]) =>
        Object.is(previous[key as keyof Preferences], next),
      )
    )
      return;
    runtime.transaction(() => undefined); // Reject a reentrant writer before storage side effects.
    const next = Object.freeze({ ...previous, ...value }),
      persistence = persist(next);
    runtime.transaction(() => {
      state.set(next);
      status.set(persistence);
    });
  };
  const state = runtime.signal<Preferences>(
    Object.freeze({
      ...defaults,
      ...initial.values,
      setView: (view: Preferences['view']) => patch({ view }),
      setTheme: (theme: Preferences['theme']) => patch({ theme }),
      setDensity: (density: Preferences['density']) => patch({ density }),
      setSidebarOpen: (sidebarOpen: boolean) => patch({ sidebarOpen }),
    }),
  );
  function receive(raw: string | null) {
    if (closed) return;
    const incoming = decode(raw);
    if (incoming.kind !== 'ready') {
      storageError = incoming.error;
      status.set(statusOf(incoming.kind, incoming.error, status.get().unsaved));
      return;
    }
    const previousStatus = status.get();
    // Any unsaved local choice needs explicit resolution, including writes
    // blocked by a future schema or a read failure, not only quota errors.
    if (previousStatus.unsaved) {
      storageError = new Error(
        'Another tab changed settings while local settings were not saved. Retry to keep this tab’s settings.',
      );
      status.set(statusOf('conflict', storageError, true));
      return;
    }
    persistedProjection = serialize(incoming.values);
    storageError = undefined;
    runtime.transaction(() => {
      state.set(Object.freeze({ ...state.get(), ...incoming.values }));
      status.set(ready);
    });
  }
  const stop = listen?.(receive);
  const values = toExternalStore(state),
    persistence = toExternalStore(status);
  return Object.freeze({
    getSnapshot: () => values.getSnapshot(),
    subscribe: (notify: () => void) => values.subscribe(notify),
    getStorageError: () => storageError,
    getPersistenceSnapshot: () => persistence.getSnapshot(),
    subscribePersistence: (notify: () => void) => persistence.subscribe(notify),
    retryPersistence: () => {
      if (closed) return;
      runtime.transaction(() => undefined);
      status.set(persist(state.get(), true));
    },
    dispose: () => {
      if (closed) return;
      runtime.dispose();
      stop?.();
      closed = true;
    },
  });
}
