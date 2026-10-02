import { draftPersistence } from './draft-persistence';
import { useEffect, useLayoutEffect, useRef, useState, type SetStateAction } from 'react';

export type InputDraftScope = { workspace_id: string; id: string };
export function inputDraftKey(scope: InputDraftScope | undefined, name: string) {
  return ['input-draft', scope?.workspace_id ?? '', scope?.id ?? '', name]
    .map(encodeURIComponent)
    .join(':');
}
type Snapshot<T> = { key: string; value: T; revision: string; stored: boolean; error: boolean };
function read<T>(key: string, initial: T): Snapshot<T> {
  try {
    const raw = draftPersistence.getItem(key);
    if (raw !== null) {
      const entry = JSON.parse(raw) as { format: number; value: T; revision: string };
      if (entry.format !== 1 || typeof entry.revision !== 'string')
        throw new Error('Invalid draft');
      return { key, value: entry.value, revision: entry.revision, stored: true, error: false };
    }
  } catch {
    return { key, value: initial, revision: '', stored: false, error: true };
  }
  return { key, value: initial, revision: '', stored: false, error: false };
}
/** Explicit non-secret input only. Acknowledgements clear exactly the submitted revision. */
export function useInputDraft<T>(key: string, initial: T) {
  const [state, setState] = useState(() => read(key, initial));
  const current = useRef(state);
  if (state.key !== key) setState(read(key, initial));
  useLayoutEffect(() => {
    current.current = state;
  }, [state]);
  const update = (next: Snapshot<T>) => {
    current.current = next;
    setState(next);
  };
  const setValue = (value: SetStateAction<T>) => {
    const next =
      typeof value === 'function' ? (value as (v: T) => T)(current.current.value) : value;
    const snapshot = {
      key,
      value: next,
      revision: crypto.randomUUID(),
      stored: true,
      error: false,
    };
    try {
      draftPersistence.setItem(
        key,
        JSON.stringify({ format: 1, value: next, revision: snapshot.revision }),
      );
    } catch {
      snapshot.error = true;
    }
    update(snapshot);
  };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (current.current.stored && current.current.error) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  return {
    value: state.value,
    set: setValue,
    error: state.error,
    dirty: state.stored,
    snapshot: () => ({ key, revision: current.current.revision, value: current.current.value }),
    accept: (sent: { key: string; revision: string }, replacement: T = initial) => {
      if (
        sent.key !== key ||
        current.current.key !== key ||
        sent.revision !== current.current.revision
      )
        return false;
      try {
        const persisted = draftPersistence.getItem(key);
        if (persisted !== null && JSON.parse(persisted).revision !== sent.revision) return false;
        draftPersistence.removeItem(key);
      } catch {
        update({ ...current.current, error: true });
        return false;
      }
      update({ key, value: replacement, revision: '', stored: false, error: false });
      return true;
    },
    replaceClean: (value: T) => {
      if (!current.current.stored) update({ ...current.current, value });
    },
  };
}
