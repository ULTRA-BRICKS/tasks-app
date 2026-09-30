import { useState } from 'react';
import { CloudOff } from 'lucide-react';
import { readCache, type ReadCacheState } from '@/shared/lib/read-cache';
import { Button } from '@/shared/ui';
import { useReadCacheState, type SavedCopySource } from './model';
const time = (value: number) =>
  new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(value);
const synced = (value: number | null) => {
  if (value === null) return 'earlier';
  const day = new Date(value).toDateString() === new Date().toDateString();
  return (
    (day
      ? ''
      : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(value) + ', ') +
    time(value)
  );
};
function reason(state: ReadCacheState) {
  switch (state.problem) {
    case 'offline':
      return 'No connection to Tasks. Editing resumes when it reconnects.';
    case 'rate-limited':
      return `The server asked Tasks to wait. Retrying${state.retryAt ? ' at ' + time(state.retryAt) : ''}.`;
    case 'server':
      return `The server is unavailable. Retrying${state.retryAt ? ' at ' + time(state.retryAt) : ''}.`;
    default:
      return 'Checking your session…';
  }
}
const STORAGE_NOTE: Partial<Record<ReadCacheState['storage'], string>> = {
  full: 'This device is out of browser storage, so Tasks stopped saving an offline copy.',
  denied: 'This browser does not allow Tasks to keep an offline copy.',
  failed: 'Tasks could not keep an offline copy in this browser.',
};
/**
 * Explains a warm start: the page shows the last confirmed copy, read-only until the session is
 * confirmed. Also reports when offline copies cannot be kept at all; Dismiss hides that note until
 * a different storage problem occurs.
 */
export function SavedCopyNotice({ source = readCache }: { source?: SavedCopySource }) {
  const state = useReadCacheState(source);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (state.phase === 'restored')
    return (
      <div className="saved-copy-notice">
        <CloudOff size={15} aria-hidden="true" />
        <output aria-label="Saved copy">
          <strong>Saved copy from {synced(state.syncedAt)}</strong>
          <span>Read-only. {reason(state)} Unsent drafts stay on this device.</span>
        </output>
        {state.problem && (
          <Button size="sm" variant="ghost" onClick={() => source.retry()}>
            Retry now
          </Button>
        )}
      </div>
    );
  const note = state.phase === 'live' ? STORAGE_NOTE[state.storage] : undefined;
  if (!note || dismissed === state.storage) return null;
  return (
    <div className="saved-copy-notice is-storage">
      <CloudOff size={15} aria-hidden="true" />
      <output aria-label="Offline copy">
        <span>{note} Everything still works online.</span>
      </output>
      <Button size="sm" variant="ghost" onClick={() => setDismissed(state.storage)}>
        Dismiss
      </Button>
    </div>
  );
}
