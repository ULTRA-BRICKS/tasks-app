/**
 * Persistent read cache: confirmed, allowlisted TanStack Query replies saved in IndexedDB per
 * account and workspace. A warm start renders the saved copy as stale and read-only; GET /v1/me
 * confirms the session. Sign-out, a revoked session or an account switch deletes the private copy
 * in every tab. Contract: docs/PERSISTENT-READ-CACHE.md.
 */
import {
  hashKey,
  type Query,
  type QueryCacheNotifyEvent,
  type QueryClient,
} from '@tanstack/react-query';
import { ApiError } from '@/shared/api/client';
import {
  READ_CACHE_LIMITS,
  READ_CACHE_SCHEMA,
  READ_CACHE_TTL_MS,
  isPersistedQueryKey,
  sanitizeReadModel,
  type ReadCacheLimits,
} from './read-cache-policy';

export type ReadCachePhase = 'cold' | 'restored' | 'live' | 'signed-out';
export type ReadCacheStorage = 'ready' | 'unsupported' | 'denied' | 'full' | 'failed';
export type ReadCacheProblem = 'offline' | 'rate-limited' | 'server';
export interface ReadCacheState {
  /** cold: nothing restored yet; restored: saved copy, session unconfirmed; live: confirmed. */
  phase: ReadCachePhase;
  /** Newest server confirmation time among restored entries. */
  syncedAt: number | null;
  storage: ReadCacheStorage;
  /** Why a restored copy is not yet confirmed; only set while phase is 'restored'. */
  problem: ReadCacheProblem | null;
  retryAt: number | null;
}
type EventSource = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
export interface ReadCacheOptions {
  indexedDB: IDBFactory | null;
  channelName: string;
  /** Use BroadcastChannel when the platform has it; the storage event is the fallback. */
  broadcast: boolean;
  signalStorage: Pick<Storage, 'setItem' | 'removeItem'> | null;
  signalEvents: EventSource | null;
  onlineEvents: EventSource | null;
  online: () => boolean;
  now: () => number;
  flushDelayMs: number;
  openTimeoutMs: number;
  schema: number;
  limits: ReadCacheLimits;
}
export interface ReadCache {
  getState(): ReadCacheState;
  subscribe(listener: () => void): () => void;
  /** Loads this device's confirmed copy into `client`; resolves to the number of restored entries. */
  restore(client: QueryClient): Promise<number>;
  /** Observes `client` for confirmed replies, session changes and other tabs. Returns detach. */
  attach(client: QueryClient): () => void;
  canWrite(): boolean;
  /** Explicit sign-out: deletes every saved copy here and in other tabs. */
  signOut(): Promise<void>;
  /** The server rejected the session (401). Same deletion as sign-out. */
  revoke(): Promise<void>;
  /** Revalidate the session now (after offline, 429 or a server error). */
  retry(): void;
  /** Settles queued writes and resets; for shutdown and tests. */
  flush(): Promise<void>;
}
interface Entry {
  id: string;
  partition: string;
  schema: number;
  hash: string;
  key: unknown[];
  json: string;
  savedAt: number;
}
interface Pointer {
  id: typeof POINTER;
  partition: string;
  schema: number;
}
interface EntryIndex {
  id: string;
  /** Oldest first; the account entry is never evicted. */
  order: [hash: string, savedAt: number][];
}
type Signal = { type: 'cleared' } | { type: 'account'; partition: string };
type Envelope = Signal & { origin: string; nonce: string };

const DB_NAME = 'tasks-read-cache';
const ENTRIES = 'entries';
const META = 'meta';
const POINTER = 'pointer';
const SIGNAL_KEY = 'tasks-read-cache-signal';
const SEPARATOR = '\u0001';
const ACCOUNT_HASH = hashKey(['me']);
const BACKOFF_MS = [15_000, 30_000, 60_000, 120_000];

function settle<T>(request: IDBRequest<T>) {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  return promise;
}
function committed(tx: IDBTransaction) {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
  tx.onerror = () => undefined;
  return promise;
}
function quotaError(error: unknown) {
  return error instanceof DOMException && error.name === 'QuotaExceededError';
}
function partitionOf(actor: unknown) {
  const value = actor as { id?: unknown; workspace_id?: unknown } | null;
  return typeof value?.id === 'string' && typeof value.workspace_id === 'string'
    ? JSON.stringify([value.id, value.workspace_id])
    : null;
}
function envelope(value: unknown): Envelope | null {
  const item = value as Partial<Envelope> | null;
  if (!item || typeof item.origin !== 'string' || typeof item.nonce !== 'string') return null;
  if (item.type === 'cleared') return item as Envelope;
  return item.type === 'account' && typeof item.partition === 'string' ? (item as Envelope) : null;
}
function defaults(): ReadCacheOptions {
  const browser = typeof window !== 'undefined';
  let signalStorage: Storage | null = null;
  try {
    signalStorage = browser ? window.localStorage : null;
  } catch {
    /* Storage can be denied; BroadcastChannel still works. */
  }
  return {
    indexedDB: typeof indexedDB === 'undefined' ? null : indexedDB,
    channelName: DB_NAME,
    broadcast: true,
    signalStorage,
    signalEvents: browser ? window : null,
    onlineEvents: browser ? window : null,
    online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    now: Date.now,
    flushDelayMs: 400,
    openTimeoutMs: 3000,
    schema: READ_CACHE_SCHEMA,
    limits: READ_CACHE_LIMITS,
  };
}

export function createReadCache(overrides: Partial<ReadCacheOptions> = {}): ReadCache {
  const options: ReadCacheOptions = { ...defaults(), ...overrides };
  const tabId = crypto.randomUUID();
  const listeners = new Set<() => void>();
  const pending = new Map<string, Entry>();
  const fetchEpochs = new WeakMap<Query, number>();
  /**
   * Replies of this epoch that arrived before /me confirmed the session. They are written once /me
   * confirms the same account; a sign-out, 401 or account switch (a new epoch) drops them.
   */
  const held = new Set<Query>();
  const seen: string[] = [];
  const settling = new Set<Promise<unknown>>();
  let state: ReadCacheState = {
    phase: 'cold',
    syncedAt: null,
    storage: options.indexedDB ? 'ready' : 'unsupported',
    problem: null,
    retryAt: null,
  };
  /** Increments on sign-out, revocation and account switch; older replies are never persisted. */
  let epoch = 0;
  let partition: string | null = null;
  /** Saved entries of `partition` in eviction order (oldest first). */
  let known = new Map<string, number>();
  let database: Promise<IDBDatabase | null> | null = null;
  let work: Promise<void> = Promise.resolve();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let client: QueryClient | null = null;
  let channel: BroadcastChannel | null = null;

  function update(patch: Partial<ReadCacheState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }
  function track<T>(promise: Promise<T>) {
    settling.add(promise);
    void promise.finally(() => settling.delete(promise)).catch(() => undefined);
    return promise;
  }
  /** Serializes IndexedDB work so a deletion is never overtaken by an older write. */
  function enqueue(task: () => Promise<void>) {
    work = work.then(task).catch(() => {
      if (state.storage === 'ready') update({ storage: 'failed' });
    });
    return work;
  }
  function open() {
    database ??= (async () => {
      const factory = options.indexedDB;
      if (!factory) return null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = Promise.withResolvers<never>();
      const connect = () => {
        const request = factory.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(ENTRIES))
            db.createObjectStore(ENTRIES, { keyPath: 'id' }).createIndex('partition', 'partition');
          if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
        };
        return Promise.race([settle(request), timeout.promise]);
      };
      try {
        timer = setTimeout(
          () => timeout.reject(new DOMException('IndexedDB did not open', 'TimeoutError')),
          options.openTimeoutMs,
        );
        let db = await connect();
        if (!db.objectStoreNames.contains(ENTRIES) || !db.objectStoreNames.contains(META)) {
          // Another opener created this version without our stores; rebuild it once.
          db.close();
          await Promise.race([settle(factory.deleteDatabase(DB_NAME)), timeout.promise]);
          db = await connect();
        }
        db.onversionchange = () => {
          db.close();
          database = null;
        };
        return db;
      } catch (error) {
        const name = error instanceof DOMException ? error.name : '';
        update({
          storage: name === 'SecurityError' || name === 'InvalidStateError' ? 'denied' : 'failed',
        });
        return null;
      } finally {
        clearTimeout(timer);
      }
    })();
    return database;
  }
  async function wipe() {
    const db = await open();
    if (!db) return;
    const tx = db.transaction([ENTRIES, META], 'readwrite');
    tx.objectStore(ENTRIES).clear();
    tx.objectStore(META).clear();
    await committed(tx);
  }
  async function readIndex(db: IDBDatabase, owner: string) {
    const index = (await settle(
      db
        .transaction(META)
        .objectStore(META)
        .get('index:' + owner),
    )) as EntryIndex | undefined;
    return new Map(index?.order ?? []);
  }
  /** Enforces the one-account-per-device invariant for a newly confirmed partition. */
  async function adopt(owner: string, expected: number) {
    const db = await open();
    if (!db || epoch !== expected) return;
    const tx = db.transaction([ENTRIES, META], 'readwrite');
    const entries = tx.objectStore(ENTRIES),
      meta = tx.objectStore(META);
    const cursor = entries.index('partition').openKeyCursor();
    cursor.onsuccess = () => {
      const row = cursor.result;
      if (!row) return;
      if (row.key !== owner) entries.delete(row.primaryKey);
      row.continue();
    };
    const metaKeys = meta.getAllKeys();
    metaKeys.onsuccess = () => {
      for (const id of metaKeys.result)
        if (typeof id === 'string' && id.startsWith('index:') && id !== 'index:' + owner)
          meta.delete(id);
    };
    meta.put({ id: POINTER, partition: owner, schema: options.schema } satisfies Pointer);
    await committed(tx);
    if (epoch === expected && partition === owner) known = await readIndex(db, owner);
  }
  /**
   * Applies `change` to the account's stored eviction index inside `tx`. Tabs of one account share
   * that index, so no tab drops entries another tab saved (those would never be evicted).
   * Resolves with the committed index; rejects with the real cause (e.g. QuotaExceededError).
   */
  async function changeIndex(
    tx: IDBTransaction,
    owner: string,
    change: (order: Map<string, number>) => void,
  ) {
    const meta = tx.objectStore(META);
    const read = meta.get('index:' + owner);
    const written = Promise.withResolvers<Map<string, number>>();
    read.onsuccess = () => {
      try {
        const order = new Map((read.result as EntryIndex | undefined)?.order ?? []);
        change(order);
        meta.put({ id: 'index:' + owner, order: [...order] } satisfies EntryIndex);
        written.resolve(order);
      } catch (error) {
        written.reject(error);
        tx.abort();
      }
    };
    const [, order] = await Promise.all([committed(tx), written.promise]);
    return order;
  }
  async function writeBatch(db: IDBDatabase, owner: string, batch: Entry[]) {
    const tx = db.transaction([ENTRIES, META], 'readwrite');
    const entries = tx.objectStore(ENTRIES);
    try {
      for (const entry of batch) entries.put(entry);
      tx.objectStore(META).put({
        id: POINTER,
        partition: owner,
        schema: options.schema,
      } satisfies Pointer);
    } catch (error) {
      tx.abort();
      throw error;
    }
    known = await changeIndex(tx, owner, (order) => {
      for (const entry of batch) {
        order.delete(entry.hash);
        order.set(entry.hash, entry.savedAt);
      }
      for (const hash of order.keys()) {
        if (order.size <= options.limits.entries) break;
        if (hash === ACCOUNT_HASH) continue;
        order.delete(hash);
        entries.delete(owner + SEPARATOR + hash);
      }
    });
  }
  /** Frees the oldest half of this account's entries (never the account itself). */
  async function evict(db: IDBDatabase, owner: string, keep: Set<string>) {
    const tx = db.transaction([ENTRIES, META], 'readwrite');
    const entries = tx.objectStore(ENTRIES);
    known = await changeIndex(tx, owner, (order) => {
      const candidates = [...order.keys()].filter(
        (hash) => hash !== ACCOUNT_HASH && !keep.has(hash),
      );
      for (const hash of candidates.slice(0, Math.ceil(candidates.length / 2))) {
        order.delete(hash);
        entries.delete(owner + SEPARATOR + hash);
      }
    });
  }
  function flushNow() {
    clearTimeout(flushTimer);
    flushTimer = undefined;
    const batch = [...pending.values()];
    pending.clear();
    const owner = partition,
      expected = epoch;
    if (!batch.length || !owner) return work;
    return enqueue(async () => {
      if (epoch !== expected || partition !== owner || state.phase !== 'live') return;
      if (state.storage !== 'ready') return;
      const db = await open();
      // Re-check synchronously before the transaction exists: a sign-out may have landed meanwhile.
      if (!db || epoch !== expected || partition !== owner) return;
      try {
        await writeBatch(db, owner, batch);
      } catch (error) {
        if (!quotaError(error)) throw error;
        try {
          await evict(db, owner, new Set(batch.map((entry) => entry.hash)));
          if (epoch !== expected || partition !== owner) return;
          await writeBatch(db, owner, batch);
        } catch (again) {
          update({ storage: quotaError(again) ? 'full' : 'failed' });
        }
      }
    });
  }
  function queue(query: Query) {
    const owner = partition;
    if (!owner || state.phase !== 'live' || state.storage !== 'ready') return;
    const data = sanitizeReadModel(query.queryKey, query.state.data, options.limits);
    if (data === undefined) return;
    const json = JSON.stringify(data);
    if (json.length > options.limits.entryChars) {
      // Never keep an older copy of a reply that no longer fits.
      pending.delete(query.queryHash);
      if (known.has(query.queryHash))
        void enqueue(async () => {
          const db = await open();
          if (!db || partition !== owner) return;
          const tx = db.transaction(ENTRIES, 'readwrite');
          tx.objectStore(ENTRIES).delete(owner + SEPARATOR + query.queryHash);
          await committed(tx);
          known.delete(query.queryHash);
        });
      return;
    }
    pending.set(query.queryHash, {
      id: owner + SEPARATOR + query.queryHash,
      partition: owner,
      schema: options.schema,
      hash: query.queryHash,
      key: [...query.queryKey],
      json,
      savedAt: options.now(),
    });
    if (options.flushDelayMs <= 0) void flushNow();
    else flushTimer ??= setTimeout(() => void flushNow(), options.flushDelayMs);
  }
  function post(signal: Signal) {
    const message: Envelope = { ...signal, origin: tabId, nonce: crypto.randomUUID() };
    try {
      channel?.postMessage(message);
    } catch {
      /* A closed channel must not block sign-out; the storage event still reaches other tabs. */
    }
    try {
      options.signalStorage?.setItem(SIGNAL_KEY, JSON.stringify(message));
      options.signalStorage?.removeItem(SIGNAL_KEY);
    } catch {
      /* Storage may be full or denied. */
    }
  }
  /** Drops this tab's private data in memory; server state is refetched under the current cookie. */
  async function resetClient() {
    const target = client;
    if (!target) return;
    await target.cancelQueries();
    target.removeQueries({ type: 'inactive' });
    await target.resetQueries();
  }
  function forget(phase: ReadCachePhase) {
    epoch++;
    pending.clear();
    clearTimeout(flushTimer);
    clearTimeout(retryTimer);
    flushTimer = retryTimer = undefined;
    held.clear();
    partition = null;
    known = new Map();
    failures = 0;
    update({
      phase,
      syncedAt: null,
      problem: null,
      retryAt: null,
      storage: state.storage === 'full' ? 'ready' : state.storage,
    });
  }
  async function clearEverywhere() {
    const announce = state.phase === 'live' || state.phase === 'restored';
    forget('signed-out');
    if (announce) post({ type: 'cleared' });
    await track(enqueue(wipe));
  }
  function receive(value: unknown) {
    const message = envelope(value);
    if (!message || message.origin === tabId || seen.includes(message.nonce)) return;
    seen.push(message.nonce);
    if (seen.length > 32) seen.shift();
    if (message.type === 'cleared') {
      forget('signed-out');
      // Wiping here too removes any write this tab committed before the message arrived.
      void track(enqueue(wipe));
      void track(resetClient());
    } else if (partition !== null && message.partition !== partition) {
      forget('cold');
      void track(resetClient());
    }
  }
  function problemFrom(error: unknown) {
    if (state.phase !== 'restored') return;
    const problem: ReadCacheProblem =
      error instanceof ApiError && error.status === 0
        ? 'offline'
        : error instanceof ApiError && error.status === 429
          ? 'rate-limited'
          : 'server';
    const delay =
      (error instanceof ApiError ? error.retryAfterMs : undefined) ??
      BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
    failures++;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(retry, delay);
    update({ problem, retryAt: options.now() + delay });
  }
  function confirm(query: Query) {
    const owner = partitionOf(query.state.data);
    if (!owner) return;
    const previous = partition;
    if (state.phase === 'signed-out' || (previous !== null && previous !== owner)) {
      const switched = previous !== null;
      forget('live');
      if (switched) {
        post({ type: 'account', partition: owner });
        // Keep the confirming account reply; everything else belonged to the other account.
        void track(
          (async () => {
            const target = client;
            if (!target) return;
            const others = { predicate: (item: Query) => item.queryKey[0] !== 'me' };
            await target.cancelQueries(others);
            target.removeQueries({ ...others, type: 'inactive' });
            await target.resetQueries(others);
          })(),
        );
      }
    }
    fetchEpochs.set(query, epoch);
    partition = owner;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    failures = 0;
    update({ phase: 'live', problem: null, retryAt: null, syncedAt: null });
    const expected = epoch;
    void track(enqueue(() => adopt(owner, expected)));
    // A sign-in or account switch above started a new epoch and emptied `held`; otherwise the held
    // replies came from the session /me just confirmed.
    for (const reply of held)
      if (client?.getQueryCache().get(reply.queryHash) === reply) queue(reply);
    held.clear();
    queue(query);
  }
  function observe(event: QueryCacheNotifyEvent) {
    // A removed query can never be replayed (confirm checks identity), so stop holding it.
    if (event.type === 'removed') held.delete(event.query);
    if (event.type !== 'updated') return;
    const { query, action } = event;
    if (action.type === 'fetch') {
      fetchEpochs.set(query, epoch);
      return;
    }
    const current = client?.getQueryCache().get(query.queryHash) === query;
    const confirmed = fetchEpochs.get(query) === epoch;
    if (action.type === 'error') {
      if (!confirmed) return;
      // Any 401 means the session is gone; only /me failures describe revalidation problems.
      if (action.error instanceof ApiError && action.error.status === 401)
        void track(clearEverywhere());
      else if (query.queryKey[0] === 'me') problemFrom(action.error);
      return;
    }
    if (action.type !== 'success') return;
    // Manual setQueryData (optimistic edits, rollbacks, restores) is never a confirmed reply.
    if (action.manual) {
      held.delete(query);
      return;
    }
    if (!current || !confirmed) return;
    if (query.queryKey[0] === 'me' && query.queryKey.length === 1) confirm(query);
    else if (isPersistedQueryKey(query.queryKey)) {
      if (state.phase === 'live') queue(query);
      else held.add(query);
    }
  }
  function retry() {
    clearTimeout(retryTimer);
    retryTimer = undefined;
    void client?.refetchQueries({ queryKey: ['me'], exact: true });
  }

  const cache: ReadCache = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async restore(target) {
      const expected = epoch;
      const db = await open();
      if (!db) return 0;
      try {
        const pointer = (await settle(db.transaction(META).objectStore(META).get(POINTER))) as
          | Pointer
          | undefined;
        if (!pointer) return 0;
        const rows =
          pointer.schema === options.schema
            ? ((await settle(
                db
                  .transaction(ENTRIES)
                  .objectStore(ENTRIES)
                  .index('partition')
                  .getAll(pointer.partition),
              )) as Entry[])
            : [];
        const order = await readIndex(db, pointer.partition);
        const now = options.now();
        const usable = rows.filter(
          (row) =>
            row.schema === options.schema &&
            row.savedAt <= now &&
            now - row.savedAt <= READ_CACHE_TTL_MS &&
            isPersistedQueryKey(row.key),
        );
        const account = usable.find((row) => row.hash === ACCOUNT_HASH);
        if (!account || partitionOf(JSON.parse(account.json)) !== pointer.partition) {
          // Without a confirmed account copy nothing may render: discard everything.
          await track(enqueue(wipe));
          return 0;
        }
        if (epoch !== expected || state.phase !== 'cold') return 0;
        const stale = rows.filter((row) => !usable.includes(row));
        if (stale.length)
          void track(
            enqueue(async () => {
              const write = db.transaction(ENTRIES, 'readwrite');
              for (const row of stale) write.objectStore(ENTRIES).delete(row.id);
              await committed(write);
            }),
          );
        for (const row of usable) {
          target.setQueryData(row.key, JSON.parse(row.json), { updatedAt: row.savedAt });
          // However recent, a saved copy is never fresh: every mounted query revalidates.
          void target.invalidateQueries({ queryKey: row.key, exact: true, refetchType: 'none' });
        }
        partition = pointer.partition;
        known = new Map([...order].filter(([hash]) => usable.some((row) => row.hash === hash)));
        update({
          phase: 'restored',
          syncedAt: Math.max(...usable.map((row) => row.savedAt)),
          problem: options.online() ? null : 'offline',
        });
        return usable.length;
      } catch {
        update({ storage: 'failed' });
        return 0;
      }
    },
    attach(target) {
      client = target;
      const stop = target.getQueryCache().subscribe(observe);
      if (options.broadcast && typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel(options.channelName);
        channel.onmessage = (event) => receive(event.data);
      }
      const onStorage = (event: Event) => {
        const { key, newValue } = event as StorageEvent;
        if (key !== SIGNAL_KEY || !newValue) return;
        try {
          receive(JSON.parse(newValue));
        } catch {
          /* Ignore foreign or malformed values. */
        }
      };
      const onOnline = () => {
        if (state.phase === 'restored') retry();
      };
      const onOffline = () => {
        if (state.phase === 'restored') update({ problem: 'offline', retryAt: null });
      };
      options.signalEvents?.addEventListener('storage', onStorage);
      options.onlineEvents?.addEventListener('online', onOnline);
      options.onlineEvents?.addEventListener('offline', onOffline);
      return () => {
        stop();
        channel?.close();
        channel = null;
        options.signalEvents?.removeEventListener('storage', onStorage);
        options.onlineEvents?.removeEventListener('online', onOnline);
        options.onlineEvents?.removeEventListener('offline', onOffline);
        clearTimeout(flushTimer);
        clearTimeout(retryTimer);
        flushTimer = retryTimer = undefined;
        client = null;
      };
    },
    canWrite: () => state.phase === 'live',
    signOut: clearEverywhere,
    revoke: clearEverywhere,
    retry,
    async flush() {
      await flushNow();
      while (settling.size) await Promise.allSettled([...settling]);
      await flushNow();
      await work;
    },
  };
  return cache;
}
/** The application's single instance; IndexedDB opens lazily on the first restore or write. */
export const readCache = createReadCache();
