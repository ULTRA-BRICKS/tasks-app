import { stateBackend } from '@/shared/lib/state/backend';

/** Load exactly one issue-creation implementation per build. */
const selected =
  stateBackend === 'baseline' ? await import('./baseline') : await import('./state-lib');
export const NewIssuePage = selected.NewIssuePage;
