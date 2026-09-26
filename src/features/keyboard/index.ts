import { stateBackend } from '@/shared/lib/state/backend';

/** Load exactly one keyboard implementation per build (see shared/lib/state/backend). */
const selected =
  stateBackend === 'baseline' ? await import('./baseline') : await import('./state-lib');
export const WorkspaceKeyboard = selected.WorkspaceKeyboard;
