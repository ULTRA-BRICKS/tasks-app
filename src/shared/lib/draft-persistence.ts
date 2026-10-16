import { acknowledgesCopy, copyIdentity, receiptFor, receiptIdentity } from './draft-receipt';
import { advanceClock, followsClock, sameClock, type DraftClock } from './draft-version';
export type DraftOwner = { workspace_id: string; id: string };
export type RecoveryDraft = {
  key: string;
  value: string | null;
  updatedAt: number;
  writer: string;
  path: string;
  clock?: DraftClock;
  acknowledgedValue?: string;
  valueVersion?: string;
  acknowledgedVersion?: string;
};
const prefix = 'tickets-recovery-v1:';
const clockOf = (item: RecoveryDraft): DraftClock => item.clock ?? { ['legacy-' + item.writer]: 1 };
const noDrafts: RecoveryDraft[] = [];
export function draftBelongsTo(key: string, owner: DraftOwner) {
  if (!owner.id || !owner.workspace_id) return false;
  const parts = key.split(':').map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return '';
    }
  });
  return parts[0] === 'ticket-draft'
    ? parts[1] === owner.id && parts[2] === owner.workspace_id
    : ['ticket-new', 'plan-draft', 'input-draft'].includes(parts[0]) &&
        parts[1] === owner.workspace_id &&
        parts[2] === owner.id;
}
function valid(value: unknown): value is RecoveryDraft {
  if (!value || typeof value !== 'object') return false;
  const item = value as RecoveryDraft;
  return (
    typeof item.key === 'string' &&
    typeof item.writer === 'string' &&
    typeof item.path === 'string' &&
    [item.valueVersion, item.acknowledgedVersion].every(
      (id) => id === undefined || (typeof id === 'string' && id.length > 0 && id.length <= 128),
    ) &&
    Number.isFinite(item.updatedAt) &&
    Math.abs(item.updatedAt) <= 8640000000000000 &&
    (item.clock === undefined ||
      (typeof item.clock === 'object' &&
        item.clock !== null &&
        !Array.isArray(item.clock) &&
        Object.entries(item.clock).every(
          ([key, value]) =>
            /^[a-zA-Z0-9_-]+$/.test(key) &&
            !['__proto__', 'constructor', 'prototype'].includes(key) &&
            Number.isSafeInteger(value) &&
            value > 0,
        ))) &&
    (item.value === null || typeof item.value === 'string')
  );
}
/** Storage surface a store needs; real `Storage` objects satisfy it. */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
export type DraftStorageEvent = { key: string | null; newValue: string | null };
/** Every external effect a store performs. Nothing is read from a global by the factory. */
export type DraftPorts = {
  /** Durable cross-tab storage (localStorage). */
  local: DraftStorage;
  /** Per-tab mirror (sessionStorage). */
  session: DraftStorage;
  /** Subscribes to durable-storage events from other tabs; returns the unsubscribe. */
  storageEvents?: (handler: (event: DraftStorageEvent) => void) => () => void;
  /** Page path recorded with a new copy. */
  path?: () => string;
  now?: () => number;
  uuid?: () => string;
};
export type DraftRevision = { read: () => number; publish: (next: number) => void };
export type DraftPersistenceOptions = DraftPorts & {
  /** Identity of this page's causal actor; unique per instance by default. */
  writerId?: string;
  /** Host-owned revision cell (for example a scope value); a private counter by default. */
  revision?: DraftRevision;
};

/**
 * One recovery-draft store. Every map, index, cache, listener, revision and the cross-tab
 * subscription belong to the instance: `dispose()` releases them and turns every later
 * operation (including an acknowledgement that settles after disposal) into a no-op, so a
 * stale caller can never write through to the storage another owner now uses.
 */
export function createDraftPersistence(options: DraftPersistenceOptions) {
  const { local, session } = options;
  const now = options.now ?? Date.now;
  // This is a causal writer/version ID, not a credential. getRandomValues is
  // also available on a LAN preview where randomUUID requires a secure context.
  const uuid =
    options.uuid ??
    (() => {
      if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
      return [...crypto.getRandomValues(new Uint8Array(16))]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    });
  const currentPath = options.path ?? (() => '/drafts');
  const writer = options.writerId ?? uuid();
  const memory = new Map<string, RecoveryDraft | null>();
  const problems = new Map<string, string>();
  const writerCounters = new Map<string, number>();
  const listeners = new Set<() => void>();
  const byKey = new Map<string, Map<string, RecoveryDraft>>();
  const viewCache = new Map<string, RecoveryDraft[]>();
  let ownRevision = 0;
  const revision: DraftRevision = options.revision ?? {
    read: () => ownRevision,
    publish: (next) => {
      ownRevision = next;
    },
  };
  let indexed = false,
    notifying = false,
    disposed = false,
    disconnect: (() => void) | null = null;

  const notify = () => {
    revision.publish(revision.read() + 1);
    viewCache.clear();
    if (notifying) return;
    notifying = true;
    queueMicrotask(() => {
      notifying = false;
      if (disposed) return;
      for (const listener of listeners) listener();
    });
  };
  function physical(key: string, page = writer) {
    return prefix + encodeURIComponent(key) + ':' + page;
  }
  function indexRecord(item: RecoveryDraft) {
    let copies = byKey.get(item.key);
    if (!copies) {
      copies = new Map();
      byKey.set(item.key, copies);
    }
    const previous = copies.get(item.writer);
    if (previous && followsClock(clockOf(previous), clockOf(item))) return;
    copies.set(item.writer, item);
    viewCache.clear();
  }
  function ensureIndex() {
    if (indexed || disposed) return;
    try {
      for (let i = 0; i < local.length; i++) {
        const key = local.key(i);
        if (!key?.startsWith(prefix)) continue;
        try {
          const item: unknown = JSON.parse(local.getItem(key) ?? 'null');
          if (valid(item) && key === physical(item.key, item.writer)) indexRecord(item);
        } catch {
          /* Retain unreadable originals; do not replace or delete them. */
        }
      }
      indexed = true;
    } catch {
      /* Retry when persistent storage becomes available. */
    }
  }
  function copies(key: string) {
    ensureIndex();
    return [...(byKey.get(key)?.values() ?? [])];
  }
  function outstanding(key: string) {
    const items = copies(key),
      acknowledgements = new Map<string, RecoveryDraft[]>();
    for (const item of items) {
      const identity = receiptIdentity(item);
      if (item.value === null && identity !== null) {
        const matches = acknowledgements.get(identity) ?? [];
        matches.push(item);
        acknowledgements.set(identity, matches);
      }
    }
    return items.filter((item) => {
      const identity = copyIdentity(item);
      return (
        identity !== null &&
        !(acknowledgements.get(identity) ?? []).some(
          (ack) =>
            // New IDs name an exact copy, including unchanged mirrors adopted by another tab.
            // Old body-only receipts still require their causal ordering check.
            item.valueVersion !== undefined || followsClock(clockOf(ack), clockOf(item)),
        )
      );
    });
  }
  function load(key: string): string | null {
    if (disposed) return null;
    if (memory.has(key)) return memory.get(key)?.value ?? null;
    let selected: RecoveryDraft | null = null;
    try {
      const raw = session.getItem(key);
      if (raw !== null) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          /* Legacy text. */
        }
        if (valid(parsed) && parsed.clock && parsed.key === key) {
          selected = parsed;
          // Recover a successful durable write when the tab mirror was stale/full.
          for (const item of copies(key))
            if (
              (item.writer === selected.writer && followsClock(clockOf(item), clockOf(selected))) ||
              (item.value === null &&
                acknowledgesCopy(item, selected) &&
                (selected.valueVersion !== undefined ||
                  followsClock(clockOf(item), clockOf(selected))))
            )
              selected = item;
        } else {
          selected = copies(key).find((item) => item.value === raw) ?? {
            key,
            value: raw,
            writer,
            clock: advanceClock({}, writer),
            updatedAt: 0,
            path: currentPath(),
          };
        }
      }
    } catch {
      /* Fresh-tab recovery remains available from the durable index. */
    }
    selected ??=
      outstanding(key).sort(
        (a, b) => b.updatedAt - a.updatedAt || a.writer.localeCompare(b.writer),
      )[0] ?? null;
    if (selected) {
      // Bind this page's tab mirror before editing; a later failed mirror write can
      // still be reconciled against this page's durable writer, not another tab.
      selected = { ...selected, writer };
      try {
        session.setItem(key, JSON.stringify(selected));
      } catch {
        /* Edits report failures. */
      }
      indexRecord(selected);
    }
    memory.set(key, selected);
    return selected?.value ?? null;
  }
  function write(
    key: string,
    value: string | null,
    submitted?: RecoveryDraft,
    freshRevision = false,
  ) {
    if (disposed) return;
    load(key);
    const current = memory.get(key),
      old = submitted ?? current;
    const updateCurrent =
      submitted === undefined ||
      Boolean(
        current &&
        copyIdentity(current) === copyIdentity(submitted) &&
        (submitted.valueVersion !== undefined || sameClock(clockOf(current), clockOf(submitted))),
      );
    const recordWriter = value === null ? writer + '-ack-' + uuid() : writer;
    const observed = old ? clockOf(old) : {};
    // Receipt records have immutable keys, but share the page's causal actor.
    // A new actor per receipt would make the clocks grow with every submission.
    const base = {
      ...observed,
      [writer]: Math.max(observed[writer] ?? 0, writerCounters.get(key) ?? 0),
    };
    const nextClock = advanceClock(base, writer);
    writerCounters.set(key, nextClock[writer]);
    const item = {
      key,
      value,
      writer: recordWriter,
      clock: nextClock,
      ...(value === null && old?.value != null ? receiptFor(old) : {}),
      ...(value !== null
        ? {
            valueVersion: !freshRevision && old?.value === value ? old.valueVersion : uuid(),
          }
        : {}),
      updatedAt: Math.max(now(), (old?.updatedAt ?? 0) + 1),
      path: old && (value === null || value === old.value) ? old.path : currentPath(),
    };
    if (updateCurrent) memory.set(key, item);
    indexRecord(item);
    const serialized = JSON.stringify(item);
    let tab = false,
      durable = false;
    try {
      if (updateCurrent) {
        if (value === null) session.removeItem(key);
        else session.setItem(key, serialized);
        tab = true;
      }
    } catch {}
    try {
      local.setItem(physical(key, item.writer), serialized);
      durable = true;
    } catch {}
    if (durable) problems.delete(key);
    else
      problems.set(
        key,
        tab
          ? 'Only a tab-session copy is available. Export before closing the tab.'
          : 'Storage is unavailable. Keep this page open and export your drafts now.',
      );
    notify();
    if (!tab && !durable) throw new Error('Draft remains only in page memory');
  }
  function onStorage(e: DraftStorageEvent) {
    if (disposed) return;
    let cleared = false;
    const removed = new Set<string>();
    if (e.key === null) {
      cleared = true;
      indexed = false;
      byKey.clear();
    } else if (e.key.startsWith(prefix)) {
      if (e.newValue !== null) {
        try {
          const item: unknown = JSON.parse(e.newValue);
          if (valid(item) && e.key === physical(item.key, item.writer)) indexRecord(item);
        } catch {
          /* Ignore invalid event data without touching saved originals. */
        }
      } else {
        for (const [key, copies] of byKey)
          for (const writer of copies.keys())
            if (physical(key, writer) === e.key) {
              copies.delete(writer);
              removed.add(key);
            }
      }
    } else return;
    // Active edits are tab-local and are never replaced by a remote storage event.
    if (cleared) {
      for (const item of memory.values()) if (item) indexRecord(item);
    } else
      for (const key of removed) {
        const item = memory.get(key);
        if (item) indexRecord(item);
      }
    notify();
  }

  return {
    writerId: writer,
    getItem: load,
    capture: (key: string): RecoveryDraft | null => {
      load(key);
      const item = memory.get(key);
      return item?.value != null ? { ...item, clock: { ...clockOf(item) } } : null;
    },
    acknowledge: (submitted: RecoveryDraft) => {
      if (!valid(submitted) || submitted.value === null) throw new Error('Invalid submitted draft');
      write(submitted.key, null, submitted);
    },
    setItem: (key: string, value: string) => write(key, value),
    removeItem: (key: string) => {
      if (load(key) !== null) write(key, null);
    },
    subscribe: (listener: () => void) => {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => revision.read(),
    list: (owner: DraftOwner) => {
      if (disposed) return noDrafts;
      ensureIndex();
      const scope = JSON.stringify([owner.workspace_id, owner.id]);
      const cached = viewCache.get(scope);
      if (cached) return cached;
      const result: RecoveryDraft[] = [];
      for (const key of byKey.keys()) {
        if (!draftBelongsTo(key, owner)) continue;
        const values = new Set<string>();
        for (const item of outstanding(key))
          if (item.value !== null && !values.has(item.value)) {
            values.add(item.value);
            result.push(item);
          }
      }
      result.sort((a, b) => b.updatedAt - a.updatedAt || a.writer.localeCompare(b.writer));
      viewCache.set(scope, result);
      return result;
    },
    warnings: (owner: DraftOwner) => [...problems].filter(([key]) => draftBelongsTo(key, owner)),
    hasLocalCopies: (owner: DraftOwner) => {
      ensureIndex();
      return [...byKey.keys()].some((key) => draftBelongsTo(key, owner));
    },
    removeLocalCopies: (owner: DraftOwner) => {
      if (disposed) return;
      // Called only after explicit confirmation in recovery UI, never on autosave.
      const names = Array.from({ length: local.length }, (_, i) => local.key(i));
      for (const name of names) {
        if (!name?.startsWith(prefix)) continue;
        let item: unknown;
        try {
          item = JSON.parse(local.getItem(name) ?? 'null');
        } catch {
          continue;
        }
        if (
          valid(item) &&
          name === physical(item.key, item.writer) &&
          draftBelongsTo(item.key, owner)
        )
          local.removeItem(name);
      }
      const tabKeys = Array.from({ length: session.length }, (_, i) => session.key(i));
      for (const key of tabKeys) if (key && draftBelongsTo(key, owner)) session.removeItem(key);
      for (const key of new Set([...memory.keys(), ...byKey.keys()]))
        if (draftBelongsTo(key, owner)) {
          memory.delete(key);
          byKey.delete(key);
          writerCounters.delete(key);
          problems.delete(key);
        }
      notify();
    },
    migrate: (owner: DraftOwner) => {
      if (disposed) return;
      try {
        const keys = Array.from({ length: session.length }, (_, i) => session.key(i));
        for (const key of keys)
          if (key && draftBelongsTo(key, owner)) {
            const wasLoaded = memory.has(key);
            const value = load(key);
            if (value !== null && !wasLoaded) write(key, value);
          }
      } catch {
        /* Preserve originals when a recovery copy cannot be written. */
      }
    },
    restore: (item: RecoveryDraft, owner: DraftOwner) => {
      if (!draftBelongsTo(item.key, owner) || item.value === null)
        throw new Error('Draft is outside this account');
      if (disposed) return;
      const previous = load(item.key),
        previousCopy = memory.get(item.key);
      if (previous !== null && previous !== item.value && previousCopy) {
        const backupWriter = uuid();
        const backup = {
          ...previousCopy,
          writer: backupWriter,
          clock: advanceClock(clockOf(previousCopy), backupWriter),
        };
        local.setItem(physical(backup.key, backup.writer), JSON.stringify(backup));
        indexRecord(backup);
      }
      // Restoring is an explicit fork of the selected copy, not a merge with unrelated text.
      memory.set(item.key, item);
      write(item.key, item.value, undefined, true);
    },
    /** Starts listening for other tabs' durable writes. Idempotent; `dispose` also stops it. */
    connect: () => {
      if (!disposed && !disconnect && options.storageEvents)
        disconnect = options.storageEvents(onStorage);
      return () => {
        disconnect?.();
        disconnect = null;
      };
    },
    /** Releases the subscription, listeners, indexes and caches. Persisted copies are untouched. */
    dispose: () => {
      if (disposed) return;
      disposed = true;
      disconnect?.();
      disconnect = null;
      listeners.clear();
      memory.clear();
      problems.clear();
      writerCounters.clear();
      byKey.clear();
      viewCache.clear();
    },
    get disposed() {
      return disposed;
    },
  };
}
export type DraftPersistence = ReturnType<typeof createDraftPersistence>;

/** Ports over the real browser globals. Storage is resolved per call so access errors surface at the call. */
export function browserDraftPorts(): DraftPorts {
  const area = (pick: () => Storage): DraftStorage => ({
    getItem: (key) => pick().getItem(key),
    setItem: (key, value) => pick().setItem(key, value),
    removeItem: (key) => pick().removeItem(key),
    key: (index) => pick().key(index),
    get length() {
      return pick().length;
    },
  });
  return {
    local: area(() => localStorage),
    session: area(() => sessionStorage),
    storageEvents:
      typeof window === 'undefined'
        ? undefined
        : (handler) => {
            const listener = (e: StorageEvent) => {
              if (e.storageArea !== localStorage) return;
              handler({ key: e.key, newValue: e.newValue });
            };
            window.addEventListener('storage', listener);
            return () => window.removeEventListener('storage', listener);
          },
    path: () => (typeof location === 'undefined' ? '/drafts' : location.pathname + location.search),
  };
}

/**
 * Standalone baseline facade: one lazily built page-lifetime instance over the real browser
 * ports. The state-lib build never reads it; it owns its instance through a scope instead.
 */
let standalone: DraftPersistence | undefined;
const standaloneStore = (): DraftPersistence => {
  if (!standalone) {
    standalone = createDraftPersistence(browserDraftPorts());
    standalone.connect();
  }
  return standalone;
};
export const draftPersistence: Omit<
  DraftPersistence,
  'writerId' | 'disposed' | 'dispose' | 'connect'
> = {
  getItem: (key) => standaloneStore().getItem(key),
  capture: (key) => standaloneStore().capture(key),
  acknowledge: (submitted) => standaloneStore().acknowledge(submitted),
  setItem: (key, value) => standaloneStore().setItem(key, value),
  removeItem: (key) => standaloneStore().removeItem(key),
  subscribe: (listener) => standaloneStore().subscribe(listener),
  getSnapshot: () => standaloneStore().getSnapshot(),
  list: (owner) => standaloneStore().list(owner),
  warnings: (owner) => standaloneStore().warnings(owner),
  hasLocalCopies: (owner) => standaloneStore().hasLocalCopies(owner),
  removeLocalCopies: (owner) => standaloneStore().removeLocalCopies(owner),
  migrate: (owner) => standaloneStore().migrate(owner),
  restore: (item, owner) => standaloneStore().restore(item, owner),
};
