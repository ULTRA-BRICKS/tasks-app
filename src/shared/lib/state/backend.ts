/**
 * Build-time backend switch. `VITE_STATE_BACKEND=baseline` selects the original
 * useState/TanStack/Zustand owners; anything else selects the state-lib owners.
 * Same rule as the existing preferences and editor entry points, so one build has
 * exactly one implementation per owner and no dormant second store.
 */
export type StateBackend = 'baseline' | 'state-lib';
export const stateBackend: StateBackend =
  import.meta.env.VITE_STATE_BACKEND === 'baseline' ? 'baseline' : 'state-lib';
