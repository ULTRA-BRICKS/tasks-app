import { useSyncExternalStore } from 'react';
import { readCache, type ReadCache } from '@/shared/lib/read-cache';
/** The part of the read cache the saved-copy views need; stories pass a fixed state. */
export type SavedCopySource = Pick<ReadCache, 'getState' | 'subscribe' | 'retry'>;
export function useReadCacheState(source: SavedCopySource = readCache) {
  return useSyncExternalStore(source.subscribe, source.getState, source.getState);
}
/** True while the workspace shows the saved copy, before /me confirms the session. */
export function useShowingSavedCopy() {
  return useReadCacheState().phase === 'restored';
}
/**
 * The error a view renders instead of its data. While the saved copy is shown its notice explains
 * why the refresh failed, so the saved data stays visible; once the session is confirmed a failed
 * refresh replaces the old data with its error, as it did before the saved copy existed.
 */
export function useVisibleError<E>(query: { error: E | null; data: unknown }) {
  return useShowingSavedCopy() && query.data !== undefined ? null : query.error;
}
