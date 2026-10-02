import { useEffect, useState, useSyncExternalStore } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMe } from '@/entities/workspace';
import {
  draftPersistence,
  type RecoveryDraft,
  type DraftOwner,
} from '@/shared/lib/draft-persistence';
import { Button, ErrorState, EmptyState } from '@/shared/ui';

function exportDrafts(owner: DraftOwner) {
  const records = draftPersistence.list(owner);
  const blob = new Blob(
    [
      JSON.stringify(
        {
          format: 1,
          exportedAt: new Date().toISOString(),
          workspace: owner.workspace_id,
          user: owner.id,
          records,
        },
        null,
        2,
      ),
    ],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = 'tickets-drafts-' + new Date().toISOString().slice(0, 10) + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function useRecovery() {
  const { data: me } = useMe();
  const revision = useSyncExternalStore(draftPersistence.subscribe, draftPersistence.getSnapshot);
  useEffect(() => {
    if (me) draftPersistence.migrate(me);
  }, [me]);
  return { me, revision };
}
export function DraftMonitor() {
  const { me } = useRecovery();
  if (!me) return null;
  const warnings = draftPersistence.warnings(me);
  if (!warnings.length) return null;
  return (
    <div role="alert" className="draft-storage-alert">
      <strong>Draft backup needs attention.</strong> {warnings[0][1]}
      <Button size="sm" onClick={() => exportDrafts(me)}>
        Export drafts
      </Button>
      <Link to="/drafts">Review recovery copies</Link>
    </div>
  );
}
function summary(item: RecoveryDraft) {
  try {
    const raw = JSON.parse(item.value ?? 'null');
    const value = raw?.format === 1 ? raw.value : raw;
    return typeof value === 'string'
      ? value
      : value?.title || value?.name || value?.text || JSON.stringify(value);
  } catch {
    return item.value;
  }
}
export function DraftsPage() {
  const { me } = useRecovery(),
    navigate = useNavigate();
  const [error, setError] = useState('');
  if (!me) return null;
  const records = draftPersistence.list(me);
  function restore(item: RecoveryDraft) {
    try {
      draftPersistence.restore(item, me!);
      const path =
        /^\/(issues|projects|cycles|settings)(\/|\?|$)/.test(item.path) &&
        !item.path.startsWith('//')
          ? item.path
          : '/issues';
      void navigate(path, { state: { restoreKey: item.key } });
    } catch {
      setError('Recovery could not be completed safely. Export your copies before retrying.');
    }
  }
  return (
    <section className="draft-recovery-page">
      <header>
        <h1>Draft recovery</h1>
        <Button onClick={() => exportDrafts(me)}>Export drafts</Button>
      </header>
      <p>
        Private recovery copies for this account on this browser. Nothing here is sent
        automatically.
      </p>
      <p className="section-hint">
        Older tabs may retain earlier or already-submitted versions. Check the destination before
        sending a recovered copy. Browser storage is not a cloud backup.
      </p>
      {error && <ErrorState message={error} />}
      {!records.length && (
        <EmptyState
          title="No recovery copies"
          description="Your unsent text is saved here as you work."
        />
      )}
      {records.map((item) => (
        <article key={item.key + item.writer} className="recovery-card">
          <div className="recovery-title">
            <strong>{item.key.split(':')[0]}</strong>
            <time dateTime={new Date(item.updatedAt).toISOString()}>
              {new Date(item.updatedAt).toLocaleString()}
            </time>
          </div>
          <pre>{summary(item)}</pre>
          <Button size="sm" onClick={() => restore(item)}>
            Restore this copy
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard
                .writeText(item.value ?? '')
                .catch(() =>
                  setError('Clipboard is unavailable. Select the text or export your drafts.'),
                );
            }}
          >
            Copy raw draft
          </Button>
        </article>
      ))}
    </section>
  );
}
