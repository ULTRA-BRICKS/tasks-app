import { useSyncExternalStore } from 'react';
import { createPreferenceStore, type Preferences } from './model';

function browserStorage() {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
const store = createPreferenceStore(browserStorage());
export function usePreferences(): Preferences {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

if (import.meta.hot) import.meta.hot.dispose(() => store.dispose());
