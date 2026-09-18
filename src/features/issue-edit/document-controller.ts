import { Runtime, toExternalStore } from '@ultrabricks/state-lib';
import { mergeVersioned } from '@/shared/lib/versioned';
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
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface DocumentView {
  draft: DocumentDraft;
  error: string | null;
  storageError: boolean;
  conflict: ServerDocument | null;
  busy: boolean;
}
interface Options<T extends ServerDocument> {
  initial: T;
  storageKey: string;
  storage?: StoragePort;
  save: (sent: DocumentDraft, latest: T) => Promise<T>;
  conflictFrom?: (error: unknown) => ServerDocument | undefined;
  describeError?: (error: unknown) => string;
}
/** Client document workflow. Transport/cache retain server authority. */
export function createDocumentController<T extends ServerDocument>(options: Options<T>) {
  const runtime = new Runtime();
  let storageError = false,
    restored: DocumentDraft;
  try {
    restored = restoreDocument(
      options.storage?.getItem(options.storageKey) ?? null,
      options.initial,
    );
  } catch {
    storageError = true;
    restored = freshDraft(options.initial);
  }
  const state = runtime.signal<DocumentView>(
    Object.freeze({
      draft: Object.freeze(restored),
      error: null,
      storageError,
      conflict: null,
      busy: false,
    }),
  );
  const dirty = runtime.derive(() => draftDirty(state.get().draft));
  const snapshot = runtime.derive(() => Object.freeze({ ...state.get(), dirty: dirty.get() }));
  const external = toExternalStore(snapshot);
  let latest = { ...options.initial },
    editing = false,
    paused = false,
    requested = false;
  let active = true,
    disposed = false,
    generation = 0;
  let inFlight: Promise<T | null> | null = null;
  const current = () => state.get().draft;
  const valid = (token: number) => active && !disposed && generation === token;
  const update = (patch: Partial<DocumentView>) => {
    if (!active || disposed) return;
    runtime.transaction(() => state.set(Object.freeze({ ...state.get(), ...patch })));
  };
  function publish(next: DocumentDraft, patch: Partial<DocumentView> = {}) {
    if (!active || disposed) return;
    let failed = false;
    try {
      if (draftDirty(next)) options.storage?.setItem(options.storageKey, JSON.stringify(next));
      else options.storage?.removeItem(options.storageKey);
    } catch {
      failed = true;
    }
    update({ ...patch, draft: Object.freeze({ ...next }), storageError: failed });
  }
  function observe(incoming: T) {
    if (!active || disposed) return;
    latest = mergeVersioned(latest, incoming);
    if (!state.get().busy) {
      const next = editing
        ? advanceDocumentVersion(current(), latest)
        : observeDocument(current(), latest);
      if (next !== current()) publish(next);
    }
  }
  async function drain(token: number): Promise<T | null> {
    update({ busy: true });
    try {
      while (requested && valid(token)) {
        requested = false;
        const sent = { ...current() };
        if (!draftDirty(sent)) continue;
        if (!sent.title.trim()) {
          update({ error: 'An issue needs a title. Your draft is kept.' });
          return null;
        }
        try {
          const result = await options.save(sent, latest);
          if (!valid(token)) return null;
          if (!Number.isSafeInteger(result.version) || result.version <= sent.version)
            throw Error('The server did not advance the document version. Your draft is kept.');
          latest = mergeVersioned(latest, result);
          const accepted = advanceDocumentVersion(acceptDocument(current(), sent, result), latest);
          publish(editing ? accepted : observeDocument(accepted, latest), {
            error: null,
            conflict: null,
          });
        } catch (failure) {
          if (!valid(token)) return null;
          const incoming = options.conflictFrom?.(failure);
          let conflict: ServerDocument | null = null;
          if (incoming) {
            if (incoming.version >= latest.version) latest = { ...latest, ...incoming };
            conflict = Object.freeze({
              title: latest.title,
              description: latest.description,
              version: latest.version,
            });
          }
          paused = true;
          update({
            conflict,
            error:
              options.describeError?.(failure) ??
              (failure instanceof Error ? failure.message : String(failure)),
          });
          return null;
        }
      }
      return valid(token) ? latest : null;
    } finally {
      if (valid(token)) update({ busy: false });
    }
  }
  function commit(): Promise<T | null> {
    if (!active || disposed || paused) return Promise.resolve(null);
    requested = true;
    if (inFlight) return inFlight;
    const pending = drain(generation);
    inFlight = pending;
    const clear = () => {
      if (inFlight === pending) inFlight = null;
    };
    void pending.then(clear, clear);
    return pending;
  }
  async function flush(): Promise<T | null> {
    let result = await commit();
    while (result && active && !disposed && draftDirty(current()) && !paused)
      result = await commit();
    return result;
  }
  function dispose() {
    if (disposed) return;
    active = false;
    disposed = true;
    generation++;
    requested = false;
    inFlight = null;
    runtime.dispose();
  }
  return {
    subscribe: (notify: () => void) => external.subscribe(notify),
    getSnapshot: () => external.getSnapshot(),
    observe,
    commit,
    flush,
    dispose,
    change(this: void, field: 'title' | 'description', value: string) {
      if (!active || disposed) return;
      if (current()[field] === value) return;
      publish({ ...current(), [field]: value });
    },
    beginEdit(this: void) {
      if (active && !disposed) editing = true;
    },
    endEdit(this: void) {
      if (!active || disposed) return;
      editing = false;
      if (!state.get().busy) {
        const next = observeDocument(current(), latest);
        if (next !== current()) publish(next);
      }
    },
    async resolveConflict() {
      if (!active || disposed) return null;
      const conflict = state.get().conflict;
      if (!conflict || state.get().busy) return null;
      publish(
        {
          ...current(),
          version: conflict.version,
          baseTitle: conflict.title,
          baseDescription: conflict.description,
        },
        { conflict: null, error: null },
      );
      paused = false;
      return commit();
    },
    retry() {
      if (!active || disposed || state.get().conflict) return Promise.resolve(null);
      paused = false;
      return commit();
    },
    discard(this: void) {
      if (!active || disposed || state.get().busy) return;
      paused = false;
      publish(freshDraft(latest), { conflict: null, error: null });
    },
    // Immediate authority revocation, delayed disposal for StrictMode's replay.
    deactivate() {
      if (disposed) return;
      active = false;
      generation++;
      requested = false;
      inFlight = null;
      const token = generation;
      queueMicrotask(() => {
        if (!active && generation === token) dispose();
      });
    },
    activate() {
      if (disposed) throw Error('Document controller is disposed');
      if (!active) {
        active = true;
        generation++;
        update({ busy: false });
      }
    },
  };
}
