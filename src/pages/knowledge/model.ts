import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, errorMessage } from '@/shared/api/client';
import { draftPersistence } from '@/shared/lib/draft-persistence';
import { useUnloadWarning } from '@/shared/lib/unload-warning';
export type Kind = 'documents' | 'initiatives';
export type Knowledge = {
  id: string;
  title?: string;
  body?: string;
  name?: string;
  description?: string;
  status?: string;
  project_id?: string | null;
  initiative_id?: string | null;
  project_ids?: string[];
  owner_id?: string | null;
  owner_source_id?: string | null;
  target_date?: string | null;
  version: number;
  updated_at: string;
  archived_at: string | null;
};
export type KnowledgeDraft = {
  title: string;
  body: string;
  project_id: string | null;
  initiative_id: string | null;
  project_ids: string[];
  owner_id: string | null;
  target_date: string;
  status: string;
  version: number;
  revision: string;
  attempt?: { key: string; input: Record<string, unknown> };
};
const fromServer = (row?: Knowledge): KnowledgeDraft => ({
  title: row?.title ?? row?.name ?? '',
  body: row?.body ?? row?.description ?? '',
  project_id: row?.project_id ?? null,
  initiative_id: row?.initiative_id ?? null,
  project_ids: row?.project_ids ?? [],
  owner_id: row?.owner_id ?? row?.owner_source_id ?? null,
  target_date: row?.target_date ?? '',
  status: row?.status ?? 'planned',
  version: row?.version ?? 0,
  revision: crypto.randomUUID(),
});
function restore(key: string, row?: Knowledge) {
  try {
    const value = JSON.parse(draftPersistence.getItem(key) ?? 'null');
    if (
      value &&
      typeof value.title === 'string' &&
      value.title.length <= 300 &&
      typeof value.body === 'string' &&
      value.body.length <= 4 * 1024 * 1024 &&
      Number.isSafeInteger(value.version) &&
      typeof value.revision === 'string' &&
      Array.isArray(value.project_ids)
    )
      return value as KnowledgeDraft;
  } catch {}
  return fromServer(row);
}
export function setKnowledgeArchive(kind: Kind, id: string, version: number, archived: boolean) {
  return api('/v1/' + kind + '/' + id, { method: 'PATCH', json: { archived, version } });
}
export function useKnowledgeDraft(kind: Kind, key: string, row?: Knowledge) {
  const [draft, setDraft] = useState(() => restore(key, row)),
    [dirty, setDirty] = useState(() => draftPersistence.getItem(key) !== null);
  const [archiving, setArchiving] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [storageError, setStorageError] = useState(false),
    [conflict, setConflict] = useState<Knowledge | null>(null);
  const current = useRef(draft),
    mounted = useRef(true),
    locked = useRef(false),
    requested = useRef(false),
    editing = useRef(false),
    dirtyRef = useRef(dirty);
  const client = useQueryClient(),
    navigate = useNavigate();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const change = useCallback(
    (patch: Partial<KnowledgeDraft>) => {
      const next = { ...current.current, ...patch, revision: crypto.randomUUID() };
      current.current = next;
      dirtyRef.current = true;
      setDraft(next);
      setDirty(true);
      try {
        draftPersistence.setItem(key, JSON.stringify(next));
      } catch {
        setStorageError(true);
      }
    },
    [key],
  );
  useEffect(() => {
    if (row && !dirtyRef.current && !locked.current && !editing.current) {
      const next = fromServer(row);
      current.current = next;
      setDraft(next);
    }
  }, [row]);
  useUnloadWarning(() => (!dirtyRef.current ? 'none' : storageError ? 'lost' : 'kept'));
  async function save() {
    if (row && !dirtyRef.current) return;
    requested.current = true;
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      do {
        requested.current = false;
        if (!current.current.title.trim()) {
          setError('Give this object a title. Your draft is retained.');
          break;
        }
        if (current.current.body.length > (kind === 'documents' ? 500000 : 100000)) {
          setError(
            'This description exceeds the size limit. Your text is retained; shorten it before saving.',
          );
          break;
        }
        let sent = { ...current.current };
        const input: Record<string, unknown> =
          kind === 'documents'
            ? {
                title: sent.title.trim(),
                body: sent.body,
                project_id: sent.project_id,
                initiative_id: sent.initiative_id,
              }
            : {
                name: sent.title.trim(),
                description: sent.body,
                status: sent.status,
                owner_id: sent.owner_id,
                target_date: sent.target_date || null,
                project_ids: sent.project_ids,
              };
        if (!row && !sent.attempt) {
          change({ attempt: { key: crypto.randomUUID(), input } });
          sent = { ...current.current };
        }
        const proof = draftPersistence.capture(key);
        try {
          const result = await api<Knowledge>('/v1/' + kind + (row ? '/' + row.id : ''), {
            method: row ? 'PATCH' : 'POST',
            json: row ? { ...input, version: sent.version } : sent.attempt!.input,
            ...(!row ? { headers: { 'idempotency-key': sent.attempt!.key } } : {}),
          });
          if (proof) {
            try {
              draftPersistence.acknowledge(proof);
            } catch {
              if (mounted.current) setStorageError(true);
            }
          }
          void client.invalidateQueries({ queryKey: [kind] });
          if (!mounted.current) break;
          if (current.current.revision === sent.revision) {
            const next = fromServer(result);
            current.current = next;
            dirtyRef.current = false;
            setDraft(next);
            setDirty(false);
          } else change({ version: result.version });
          setError('');
          setConflict(null);
          if (!row) {
            void navigate('/' + kind + '/' + result.id, { replace: true });
            break;
          }
        } catch (failure) {
          if (!mounted.current) break;
          setError(errorMessage(failure));
          if (failure instanceof ApiError && failure.status === 409 && failure.details?.current)
            setConflict(failure.details.current as Knowledge);
          if (
            !row &&
            failure instanceof ApiError &&
            failure.status >= 400 &&
            failure.status < 500 &&
            ![408, 409, 429].includes(failure.status)
          )
            change({ attempt: undefined });
          break;
        }
      } while (requested.current);
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function archive(archived: boolean) {
    if (!row || locked.current || dirtyRef.current) return;
    if (
      archived &&
      !window.confirm(
        'Archive this ' +
          (kind === 'documents' ? 'document' : 'initiative') +
          '? It can be restored later.',
      )
    )
      return;
    locked.current = true;
    setBusy(true);
    setArchiving(true);
    try {
      await setKnowledgeArchive(kind, row.id, current.current.version, archived);
      void client.invalidateQueries({ queryKey: [kind] });
      if (mounted.current) void navigate('/' + kind);
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
    } finally {
      locked.current = false;
      if (mounted.current) {
        setBusy(false);
        setArchiving(false);
      }
    }
  }
  return {
    archive,
    archiving,
    draft,
    dirty,
    busy,
    error,
    storageError,
    conflict,
    change,
    save,
    beginEdit: () => {
      editing.current = true;
    },
    endEdit: () => {
      editing.current = false;
    },
    retryConflict: () => {
      if (conflict) {
        change({ version: conflict.version });
        setConflict(null);
        void save();
      }
    },
    useServer: () => {
      if (!conflict || !window.confirm('Replace your local changes with the shown server version?'))
        return;
      const next = fromServer(conflict);
      current.current = next;
      setDraft(next);
      dirtyRef.current = false;
      setDirty(false);
      draftPersistence.removeItem(key);
      setConflict(null);
      setError('');
    },
  };
}
