/** Load exactly one implementation so the A/B comparison has no dormant second store. */
export const preferenceBackend =
  import.meta.env.VITE_STATE_BACKEND === 'baseline' ? 'baseline' : 'state-lib';
const selected =
  preferenceBackend === 'baseline' ? await import('./baseline-entry') : await import('./state-lib');
export const usePreferences = selected.usePreferences;
export const usePreferencePersistence = selected.usePreferencePersistence;
if (typeof document !== 'undefined')
  document.documentElement.dataset.preferenceBackend = preferenceBackend;
