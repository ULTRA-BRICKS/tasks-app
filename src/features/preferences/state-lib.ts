import { useSyncExternalStore } from 'react';
import { createPreferenceStore, type Preferences } from './model';

function browserStorage() {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
// CSR-only singleton. SSR would require a separate store per request.
const storage = browserStorage();
const store = createPreferenceStore(storage, (changed) => {
  if (typeof window === 'undefined') return () => {};
  const receive = (event: StorageEvent) => {
    if (event.storageArea === storage && (event.key === 'tickets-ui' || event.key === null))
      changed(event.newValue);
  };
  window.addEventListener('storage', receive);
  return () => window.removeEventListener('storage', receive);
});
export function usePreferences(): Preferences {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

if (import.meta.hot) import.meta.hot.dispose(() => store.dispose());

export function usePreferencePersistence() {
  const status = useSyncExternalStore(
    store.subscribePersistence,
    store.getPersistenceSnapshot,
    store.getPersistenceSnapshot,
  );
  return { ...status, retry: store.retryPersistence };
}
