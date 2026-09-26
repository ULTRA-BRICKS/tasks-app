import { mergeVersioned } from '@/shared/lib/versioned';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { IssueDetail } from '@tickets/contracts';
import { useIssueUpdate } from './model';
import {
  freshDraft,
  draftDirty,
  observeDocument,
  acceptDocument,
  advanceDocumentVersion,
  restoreDocument,
  type DocumentDraft,
  type ServerDocument,
} from '@/shared/lib/draft';
import { ApiError, errorMessage } from '@/shared/api/client';
export function useInlineDocument(issue: IssueDetail, storageKey: string) {
  const [draft, setDraft] = useState(() => {
    try {
      return restoreDocument(sessionStorage.getItem(storageKey), issue);
    } catch {
      return freshDraft(issue);
    }
  });
  const current = useRef(draft),
    latest = useRef(issue),
    running = useRef(false),
    editing = useRef(false),
    requested = useRef(false),
    paused = useRef(false);
  const inFlight = useRef<Promise<IssueDetail | null> | null>(null);
  const [error, setError] = useState<string | null>(null),
    [storageError, setStorageError] = useState(false),
    [conflict, setConflict] = useState<ServerDocument | null>(null);
  const mutation = useIssueUpdate();
  const publish = useCallback(
    (next: DocumentDraft) => {
      current.current = next;
      setDraft(next);
      try {
        if (draftDirty(next)) sessionStorage.setItem(storageKey, JSON.stringify(next));
        else sessionStorage.removeItem(storageKey);
      } catch {
        setStorageError(true);
      }
    },
    [storageKey],
  );
  useEffect(() => {
    if (issue.version >= latest.current.version) latest.current = issue;
    if (!running.current) {
      const next = editing.current
        ? advanceDocumentVersion(current.current, issue)
        : observeDocument(current.current, issue);
      if (next !== current.current) publish(next);
    }
  }, [issue, publish]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (draftDirty(current.current)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  async function drain(): Promise<IssueDetail | null> {
    running.current = true;
    try {
      while (requested.current) {
        requested.current = false;
        const sent = { ...current.current };
        if (!draftDirty(sent)) continue;
        if (!sent.title.trim()) {
          setError('A task needs a title. Your draft is kept.');
          return null;
        }
        try {
          const result = await mutation.mutateAsync({
            issue: { ...latest.current, version: sent.version },
            patch: { title: sent.title, description: sent.description },
          });
          latest.current = mergeVersioned(latest.current, result);
          const accepted = advanceDocumentVersion(
            acceptDocument(current.current, sent, result),
            latest.current,
          );
          publish(editing.current ? accepted : observeDocument(accepted, latest.current));
          setError(null);
          setConflict(null);
        } catch (failure) {
          if (failure instanceof ApiError && failure.details?.current) {
            const incoming = failure.details.current as Partial<IssueDetail>;
            if (
              typeof incoming.title === 'string' &&
              typeof incoming.description === 'string' &&
              typeof incoming.version === 'number'
            ) {
              latest.current = mergeVersioned(latest.current, incoming as IssueDetail);
              setConflict({
                title: latest.current.title,
                description: latest.current.description,
                version: latest.current.version,
              });
            }
          }
          paused.current = true;
          setError(errorMessage(failure));
          return null;
        }
      }
      return latest.current;
    } finally {
      running.current = false;
    }
  }
  function commit(): Promise<IssueDetail | null> {
    requested.current = true;
    if (paused.current) return Promise.resolve(null);
    if (inFlight.current) return inFlight.current;
    const pending = drain();
    inFlight.current = pending;
    void pending.then(() => {
      if (inFlight.current === pending) inFlight.current = null;
    });
    return pending;
  }
  return {
    draft,
    beginEdit: () => {
      editing.current = true;
    },
    endEdit: () => {
      editing.current = false;
      if (!running.current) {
        const next = observeDocument(current.current, latest.current);
        if (next !== current.current) publish(next);
      }
    },
    dirty: draftDirty(draft),
    busy: mutation.isPending,
    error,
    storageError,
    conflict,
    resolveConflict: () => {
      if (!conflict || running.current) return;
      publish({
        ...current.current,
        version: conflict.version,
        baseTitle: conflict.title,
        baseDescription: conflict.description,
      });
      paused.current = false;
      setConflict(null);
      setError(null);
      void commit();
    },
    change: (field: 'title' | 'description', value: string) =>
      publish({ ...current.current, [field]: value }),
    commit: () => {
      void commit();
    },
    flush: async () => {
      let result = await commit();
      while (result && draftDirty(current.current) && !paused.current) result = await commit();
      return result;
    },
    retry: () => {
      if (conflict) return;
      paused.current = false;
      void commit();
    },
    discard: () => {
      setConflict(null);
      paused.current = false;
      setError(null);
      publish(freshDraft(latest.current));
    },
  };
}
