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
const writer = typeof crypto !== 'undefined' ? crypto.randomUUID() : String(Date.now());
const memory = new Map<string, RecoveryDraft | null>();
const problems = new Map<string, string>();
const writerCounters = new Map<string, number>();
const listeners = new Set<() => void>();
const byKey = new Map<string, Map<string, RecoveryDraft>>();
const viewCache = new Map<string, RecoveryDraft[]>();
let indexed = false,
  revision = 0,
  notifying = false;
const clockOf = (item: RecoveryDraft): DraftClock => item.clock ?? { ['legacy-' + item.writer]: 1 };
const notify = () => {
  revision++;
  viewCache.clear();
  if (notifying) return;
  notifying = true;
  queueMicrotask(() => {
    notifying = false;
    for (const listener of listeners) listener();
  });
};
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
  if (indexed) return;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      try {
        const item: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
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
  if (memory.has(key)) return memory.get(key)?.value ?? null;
  let selected: RecoveryDraft | null = null;
  try {
    const raw = sessionStorage.getItem(key);
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
          path: typeof location === 'undefined' ? '/drafts' : location.pathname + location.search,
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
      sessionStorage.setItem(key, JSON.stringify(selected));
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
  const recordWriter = value === null ? writer + '-ack-' + crypto.randomUUID() : writer;
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
          valueVersion:
            !freshRevision && old?.value === value ? old.valueVersion : crypto.randomUUID(),
        }
      : {}),
    updatedAt: Math.max(Date.now(), (old?.updatedAt ?? 0) + 1),
    path:
      old && (value === null || value === old.value)
        ? old.path
        : typeof location === 'undefined'
          ? '/drafts'
          : location.pathname + location.search,
  };
  if (updateCurrent) memory.set(key, item);
  indexRecord(item);
  const serialized = JSON.stringify(item);
  let session = false,
    durable = false;
  try {
    if (updateCurrent) {
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, serialized);
      session = true;
    }
  } catch {}
  try {
    localStorage.setItem(physical(key, item.writer), serialized);
    durable = true;
  } catch {}
  if (durable) problems.delete(key);
  else
    problems.set(
      key,
      session
        ? 'Only a tab-session copy is available. Export before closing the tab.'
        : 'Storage is unavailable. Keep this page open and export your drafts now.',
    );
  notify();
  if (!session && !durable) throw new Error('Draft remains only in page memory');
}
export const draftPersistence = {
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
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => revision,
  list: (owner: DraftOwner) => {
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
  /** Unsent drafts of this account on this device: this tab's copies plus durable recovery copies. */
  unsentCount: (owner: DraftOwner) => {
    const keys = new Set(draftPersistence.list(owner).map((item) => item.key));
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && draftBelongsTo(key, owner)) keys.add(key);
      }
    } catch {
      /* Tab storage unavailable: durable copies are still counted. */
    }
    return keys.size;
  },
  removeLocalCopies: (owner: DraftOwner) => {
    // Called only after explicit confirmation (recovery UI or sign-out), never on autosave.
    const names = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    for (const name of names) {
      if (!name?.startsWith(prefix)) continue;
      let item: unknown;
      try {
        item = JSON.parse(localStorage.getItem(name) ?? 'null');
      } catch {
        continue;
      }
      if (
        valid(item) &&
        name === physical(item.key, item.writer) &&
        draftBelongsTo(item.key, owner)
      )
        localStorage.removeItem(name);
    }
    const tabKeys = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i));
    for (const key of tabKeys)
      if (key && draftBelongsTo(key, owner)) sessionStorage.removeItem(key);
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
    try {
      const keys = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i));
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
    const previous = load(item.key),
      previousCopy = memory.get(item.key);
    if (previous !== null && previous !== item.value && previousCopy) {
      const backupWriter = crypto.randomUUID();
      const backup = {
        ...previousCopy,
        writer: backupWriter,
        clock: advanceClock(clockOf(previousCopy), backupWriter),
      };
      localStorage.setItem(physical(backup.key, backup.writer), JSON.stringify(backup));
      indexRecord(backup);
    }
    // Restoring is an explicit fork of the selected copy, not a merge with unrelated text.
    memory.set(item.key, item);
    write(item.key, item.value, undefined, true);
  },
};
if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.storageArea !== localStorage) return;
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
  });
