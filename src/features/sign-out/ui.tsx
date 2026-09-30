import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '@/entities/workspace';
import { ApiError, api, errorMessage } from '@/shared/api/client';
import { draftPersistence } from '@/shared/lib/draft-persistence';
import { readCache } from '@/shared/lib/read-cache';
import { allowUnload, textSavedNowhere } from '@/shared/lib/unload-warning';
import { Button, ErrorState, Modal } from '@/shared/ui';
/**
 * Sign-out deletes the saved workspace copy in every tab. Unsent drafts stay on this device for
 * the same account unless the user explicitly discards them (UB-39 quorum, option A3). Text an
 * editor could not save on this device is asked about before the session ends.
 */
export function SignOutButton() {
  const { data: me } = useMe(),
    client = useQueryClient();
  const [open, setOpen] = useState(false),
    [drafts, setDrafts] = useState(0),
    [unsaved, setUnsaved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const owner = me ? { id: me.id, workspace_id: me.workspace_id } : null;
  /** `choice` is the answer in the drafts dialog; null when there were no drafts to ask about. */
  async function signOut(choice: 'keep' | 'discard' | null) {
    if (busy) return;
    setBusy(true);
    setError('');
    let failure: unknown = null;
    try {
      // End the session first: other tabs reset on the broadcast and must then see a 401.
      await api('/auth/logout', { method: 'POST' });
    } catch (caught) {
      // 401: the session had already ended elsewhere, so the server side is signed out too.
      if (!(caught instanceof ApiError && caught.status === 401)) failure = caught;
    }
    // The device copy is deleted even when the server could not be reached.
    await readCache.signOut();
    if (!failure) {
      // Drafts are discarded only once signed out: while still signed in they are still wanted.
      if (choice === 'discard' && owner) draftPersistence.removeLocalCopies(owner);
      client.clear();
      // Every editor's text was asked about before the session ended; a "Leave site?" answered
      // now could only keep a signed-out page, so the navigation is let through.
      allowUnload();
      window.location.assign('/login');
      return;
    }
    // Still signed in: confirming the session again lets this tab edit instead of staying read-only.
    void client.refetchQueries({ queryKey: ['me'], exact: true });
    setError(
      errorMessage(failure) +
        ' This browser is still signed in. The saved workspace copy was deleted; try again when connected.' +
        (choice === 'discard' ? ' Nothing was discarded.' : ''),
    );
    setOpen(true);
    setBusy(false);
  }
  function request() {
    const count = owner ? draftPersistence.unsentCount(owner) : 0;
    // Drafts kept on the device and text saved nowhere are separate editors' states.
    const lost = textSavedNowhere();
    setDrafts(count);
    setUnsaved(lost);
    setError('');
    if (count || lost) setOpen(true);
    else void signOut(null);
  }
  const them = drafts === 1 ? 'it' : 'them';
  const description = [
    drafts &&
      `You have ${drafts} unsent ${drafts === 1 ? 'draft' : 'drafts'} on this device. Keep ${them} for your next sign-in to this account, or discard ${them} now.`,
    unsaved && 'Text you typed could not be saved on this device, so signing out discards it.',
    drafts
      ? 'The saved workspace copy is deleted either way.'
      : `The saved workspace copy on this device is deleted${unsaved ? ' too' : ''}.`,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <>
      <Button variant="ghost" size="icon" aria-label="Sign out" onClick={request}>
        <LogOut size={14} />
      </Button>
      <Modal
        open={open}
        onOpenChange={(next) => !busy && setOpen(next)}
        title="Sign out"
        description={description}
      >
        {error && <ErrorState message={error} />}
        <div className="dialog-footer">
          {drafts ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => void signOut('discard')}
            >
              Discard drafts and sign out
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              data-autofocus={unsaved || undefined}
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          )}
          <Button
            type="button"
            data-autofocus={!unsaved || undefined}
            disabled={busy}
            onClick={() => void signOut(drafts ? 'keep' : null)}
          >
            {busy
              ? 'Signing out…'
              : drafts
                ? 'Keep drafts and sign out'
                : unsaved
                  ? 'Discard text and sign out'
                  : 'Sign out'}
          </Button>
        </div>
      </Modal>
    </>
  );
}
