import { test, expect } from 'bun:test';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../../src/shared/api/client';
import {
  createReadCache,
  type ReadCache,
  type ReadCacheOptions,
  type ReadCacheState,
} from '../../src/shared/lib/read-cache';
import {
  READ_CACHE_TTL_MS,
  isPersistedQueryKey,
  sanitizeReadModel,
} from '../../src/shared/lib/read-cache-policy';

const alice = {
  id: 'user-a',
  name: 'Alice',
  email: 'alice@example.test',
  role: 'member',
  workspace_id: 'ws-1',
  scopes: ['read', 'write'],
  auth_type: 'session',
};
const bob = { ...alice, id: 'user-b', name: 'Bob', email: 'bob@example.test' };
const page = (ids: string[], next: string | null = null, version = 1) => ({
  data: ids.map((id) => ({ id, title: 'Task ' + id, version })),
  next_cursor: next,
});
const catalog = {
  workspace: { id: 'ws-1', name: 'Synthetic', slug: 'synthetic' },
  teams: [{ id: 'team-1', key: 'SYN', name: 'Synthetic' }],
  statuses: [],
  labels: [],
  people: [{ id: 'user-a', name: 'Alice', email: 'alice@example.test', role: 'member' }],
  source_people: [
    {
      id: 'sp-1',
      name: 'Imported',
      email: 'imported@example.test',
      provider: 'linear',
      source_id: 'x',
      avatar_url: null,
    },
  ],
  imported_files: [
    {
      id: 'f1',
      source_url: 'https://uploads.example.test/a.png?signature=private-signed-url',
      status: 'ready',
      source_status: 200,
    },
  ],
  modules: [
    {
      id: 'slack',
      name: 'Slack',
      description: 'd',
      enabled: true,
      depends: [],
      config: { user_map: { U1: 'user-a' }, webhook_secret: 'private-module-secret' },
    },
  ],
};
let channelSeq = 0;
interface Harness {
  client: QueryClient;
  cache: ReadCache;
  detach: () => void;
}
function tab(
  idb: ReadCacheOptions['indexedDB'],
  channelName: string,
  options: Partial<ReadCacheOptions> = {},
): Harness {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 } },
  });
  const cache = createReadCache({
    indexedDB: idb,
    channelName,
    flushDelayMs: 0,
    online: () => true,
    ...options,
  });
  return { client, cache, detach: cache.attach(client) };
}
function world(options: Partial<ReadCacheOptions> = {}) {
  const idb = new IDBFactory(),
    channel = 'read-cache-test-' + ++channelSeq + '-' + crypto.randomUUID();
  return {
    idb,
    open: (more: Partial<ReadCacheOptions> = {}) =>
      tab(idb as unknown as ReadCacheOptions['indexedDB'], channel, { ...options, ...more }),
  };
}
async function signIn(t: Harness, actor = alice) {
  await t.client.fetchQuery({ queryKey: ['me'], queryFn: async () => actor });
  await t.cache.flush();
}
async function load<T>(t: Harness, key: unknown[], data: T) {
  await t.client.fetchQuery({ queryKey: key, queryFn: async () => data });
  await t.cache.flush();
}
/** Resolves on the cache's own state notification; cross-tab delivery is asynchronous. */
function stateChange(t: Harness, matches: (state: ReadCacheState) => boolean) {
  const { promise, resolve } = Promise.withResolvers<void>();
  if (matches(t.cache.getState())) resolve();
  const stop = t.cache.subscribe(() => {
    if (matches(t.cache.getState())) resolve();
  });
  return promise.finally(stop);
}
/** Resolves when the in-memory query for `key` no longer holds data. */
function dataCleared(t: Harness, key: unknown[]) {
  const { promise, resolve } = Promise.withResolvers<void>();
  const check = () => {
    if (t.client.getQueryData(key) === undefined) resolve();
  };
  check();
  const stop = t.client.getQueryCache().subscribe(check);
  return promise.finally(stop);
}
function request<T>(target: IDBRequest<T>) {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  target.onsuccess = () => resolve(target.result);
  target.onerror = () => reject(target.error);
  return promise;
}
async function rawRecords(idb: IDBFactory) {
  const db = await request(idb.open('tasks-read-cache'));
  try {
    if (!db.objectStoreNames.contains('entries')) return [];
    return await request(db.transaction('entries').objectStore('entries').getAll());
  } finally {
    db.close();
  }
}

test('policy persists only allowlisted read models, never auth, token, invitation or integration queries', () => {
  for (const key of [
    ['me'],
    ['catalog'],
    ['issues', { team_id: 't' }],
    ['issue', 'id'],
    ['projects'],
    ['cycles'],
    ['milestones'],
    ['views'],
  ])
    expect(isPersistedQueryKey(key)).toBe(true);
  for (const key of [
    ['tokens'],
    ['integrations'],
    ['invitations'],
    ['account-options'],
    ['workspace-policy'],
    ['team-dependencies', 'x'],
    ['notifications'],
    ['documents', { archived: false }],
    [],
    [{ me: true }],
  ])
    expect(isPersistedQueryKey(key)).toBe(false);
});

test('sanitizer strips module configuration, signed import URLs and secret-shaped fields recursively', () => {
  const cleaned = sanitizeReadModel(['catalog'], catalog) as typeof catalog;
  expect(Object.keys(cleaned.modules[0].config)).toEqual([]);
  expect(cleaned.modules[0].enabled).toBe(true);
  expect(cleaned.imported_files).toEqual([]);
  expect(cleaned.people[0]).toMatchObject({ id: 'user-a', name: 'Alice', role: 'member' });
  const detail = sanitizeReadModel(['issue', 'i1'], {
    id: 'i1',
    title: 'Visible',
    activity: [
      {
        id: 'a',
        data: {
          access_token: 'x',
          actor_email: 'imported@example.test',
          nested: { client_secret: 'y', keep: 1 },
        },
      },
    ],
    links: [{ id: 'l', url: 'https://example.test/pr/1', title: 'PR', provider: 'github' }],
  });
  const text = JSON.stringify(detail);
  expect(text).not.toContain('access_token');
  expect(text).not.toContain('client_secret');
  expect(text).toContain('"keep":1');
  expect(text).toContain('https://example.test/pr/1');
  expect(sanitizeReadModel(['me'], { ...alice, auth_type: 'token' })).toBeUndefined();
  expect(sanitizeReadModel(['me'], { ...alice, token_hash: 'h' })).not.toHaveProperty('token_hash');
  // camelCase names are private too, so a future field cannot slip past the snake_case pattern.
  expect(
    sanitizeReadModel(['issue', 'i2'], {
      id: 'i2',
      emailAddress: 'camel@example.test',
      passwordHash: 'h',
      apiKey: 'k',
      accessToken: 't',
      displayName: 'Kept',
    }),
  ).toEqual({ id: 'i2', displayName: 'Kept' });
});

test('no email address of the account, members, imported people or history reaches the device (B2)', () => {
  const stored = JSON.stringify([
    sanitizeReadModel(['me'], alice),
    sanitizeReadModel(['catalog'], catalog),
    sanitizeReadModel(['issue', 'i1'], {
      id: 'i1',
      activity: [{ id: 'a', data: { actor_email: 'imported@example.test', emails: ['x@y.test'] } }],
    }),
  ]);
  expect(stored).not.toContain('@example.test');
  expect(stored).not.toContain('x@y.test');
  expect(stored).toContain('Alice');
  expect(stored).toContain('Imported');
});

test('warm restore renders the confirmed copy but stays stale and read-only until the session is confirmed', async () => {
  const w = world();
  const first = w.open();
  expect(first.cache.canWrite()).toBe(false);
  await signIn(first);
  expect(first.cache.getState().phase).toBe('live');
  expect(first.cache.canWrite()).toBe(true);
  await load(first, ['issues', {}], { pages: [page(['t1', 't2'])], pageParams: [undefined] });
  await load(first, ['issue', 't1'], { id: 't1', title: 'Task t1', comments: [] });
  first.detach();

  const second = w.open();
  const restored = await second.cache.restore(second.client);
  expect(restored).toBeGreaterThanOrEqual(3);
  expect(second.cache.getState().phase).toBe('restored');
  expect(second.cache.getState().syncedAt).not.toBeNull();
  expect(second.cache.canWrite()).toBe(false);
  expect(second.client.getQueryData<{ pages: unknown[] }>(['issues', {}])?.pages).toHaveLength(1);
  expect(second.client.getQueryData(['issue', 't1'])).toMatchObject({ title: 'Task t1' });
  // Restored data is stale, so mounted queries revalidate immediately.
  expect(
    second.client
      .getQueryCache()
      .find({ queryKey: ['issue', 't1'] })
      ?.isStale(),
  ).toBe(true);
  await signIn(second);
  expect(second.cache.getState().phase).toBe('live');
  expect(second.cache.canWrite()).toBe(true);
  second.detach();
});

test('optimistic edits and their rollback are never persisted; only server-confirmed data is', async () => {
  const w = world();
  const t = w.open();
  await signIn(t);
  await load(t, ['issue', 't1'], { id: 't1', title: 'Confirmed', version: 1 });
  t.client.setQueryData(['issue', 't1'], { id: 't1', title: 'Optimistic', version: 1 });
  await t.cache.flush();
  t.client.setQueryData(['issue', 't1'], { id: 't1', title: 'Confirmed', version: 1 });
  await t.cache.flush();
  t.detach();
  let next = w.open();
  await next.cache.restore(next.client);
  expect(next.client.getQueryData(['issue', 't1'])).toMatchObject({ title: 'Confirmed' });
  await signIn(next);
  await load(next, ['issue', 't1'], { id: 't1', title: 'Server v2', version: 2 });
  next.detach();
  next = w.open();
  await next.cache.restore(next.client);
  expect(next.client.getQueryData(['issue', 't1'])).toMatchObject({ title: 'Server v2' });
  next.detach();
});

test('a reply that lands before /me confirms is saved only once /me confirms the same account', async () => {
  const w = world();
  const t = w.open();
  await signIn(t);
  await load(t, ['issues', {}], { pages: [page(['t1'])], pageParams: [undefined] });
  t.detach();
  const saved = async () => JSON.stringify(await rawRecords(w.idb));

  // A warm start revalidates the first screen while /me is still pending.
  const same = w.open();
  await same.cache.restore(same.client);
  await load(same, ['issues', {}], {
    pages: [page(['t1', 'early-list'])],
    pageParams: [undefined],
  });
  await load(same, ['issue', 'early'], { id: 'early', title: 'Early reply' });
  // An optimistic change replaces a held reply, so neither is saved.
  await load(same, ['issue', 'edited'], { id: 'edited', title: 'Held reply' });
  same.client.setQueryData(['issue', 'edited'], { id: 'edited', title: 'Local change' });
  await same.cache.flush();
  expect(await saved()).not.toContain('early');
  await signIn(same);
  expect(await saved()).toContain('early-list');
  expect(await saved()).toContain('Early reply');
  expect(await saved()).not.toContain('Held reply');
  expect(await saved()).not.toContain('Local change');
  same.detach();

  // /me now names another account: the held reply may belong to either, so it is dropped.
  const other = w.open();
  await other.cache.restore(other.client);
  await load(other, ['issue', 'switch'], { id: 'switch', title: 'Reply before the switch' });
  await signIn(other, bob);
  expect(await saved()).not.toContain('Reply before the switch');
  other.detach();

  // A 401 while the reply is held deletes the copy, and a later sign-in never writes the reply.
  const revoked = w.open();
  expect(await revoked.cache.restore(revoked.client)).toBeGreaterThan(0);
  await load(revoked, ['issue', 'revoked'], { id: 'revoked', title: 'Reply before the 401' });
  await revoked.client
    .fetchQuery({
      queryKey: ['me'],
      queryFn: async () => {
        throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in');
      },
    })
    .catch(() => undefined);
  await revoked.cache.flush();
  expect(await rawRecords(w.idb)).toHaveLength(0);
  await signIn(revoked, bob);
  expect(await saved()).not.toContain('Reply before the 401');
  revoked.detach();
});

test('nothing is written after sign-out or from a late reply of an older session', async () => {
  const w = world();
  const t = w.open();
  await signIn(t);
  await load(t, ['issues', {}], { pages: [page(['t1'])], pageParams: [undefined] });
  t.detach();

  const restored = w.open();
  await restored.cache.restore(restored.client);
  const lateReply = Promise.withResolvers<unknown>();
  const late = restored.client.fetchQuery({
    queryKey: ['issue', 'late'],
    queryFn: () => lateReply.promise,
  });
  await signIn(restored);
  const oldReply = Promise.withResolvers<unknown>();
  // Bob's sign-in cancels Alice's request still in flight: its reply is neither shown nor written.
  const old = restored.client
    .fetchQuery({ queryKey: ['issue', 'old-session'], queryFn: () => oldReply.promise })
    .catch(() => undefined);
  await restored.cache.signOut();
  expect(restored.cache.getState().phase).toBe('signed-out');
  expect(restored.cache.canWrite()).toBe(false);
  lateReply.resolve({ id: 'late', title: 'Arrived after sign-out' });
  await late;
  await restored.cache.flush();
  await signIn(restored, bob);
  oldReply.resolve({ id: 'old-session', title: 'Alice reply after Bob signed in' });
  await old;
  await restored.cache.flush();
  expect(restored.client.getQueryData(['issue', 'old-session'])).toBeUndefined();
  restored.detach();

  const text = JSON.stringify(await rawRecords(w.idb));
  expect(text).not.toContain('Arrived after sign-out');
  expect(text).not.toContain('Alice reply after Bob signed in');
  expect(text).not.toContain('user-a');
});

test('an account switch discards the other account copy in memory and on the device', async () => {
  const w = world();
  const t = w.open();
  await signIn(t, alice);
  await load(t, ['issues', {}], { pages: [page(['alice-task'])], pageParams: [undefined] });
  t.detach();

  const next = w.open();
  await next.cache.restore(next.client);
  expect(JSON.stringify(next.client.getQueryData(['issues', {}]))).toContain('alice-task');
  await signIn(next, bob);
  expect(next.cache.getState().phase).toBe('live');
  expect(JSON.stringify(next.client.getQueryData(['issues', {}]) ?? null)).not.toContain(
    'alice-task',
  );
  next.detach();
  const text = JSON.stringify(await rawRecords(w.idb));
  expect(text).not.toContain('alice-task');
  expect(text).not.toContain('user-a');
  expect(text).toContain('user-b');
});

test('a revoked session (401) deletes the private copy but only the owning tab broadcasts it', async () => {
  const w = world();
  const t = w.open();
  await signIn(t);
  await load(t, ['issue', 't1'], { id: 't1', title: 'Private' });
  t.detach();
  const next = w.open();
  await next.cache.restore(next.client);
  await next.client
    .fetchQuery({
      queryKey: ['me'],
      queryFn: async () => {
        throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in');
      },
    })
    .catch(() => undefined);
  await next.cache.flush();
  expect(next.cache.getState().phase).toBe('signed-out');
  next.detach();
  expect(await rawRecords(w.idb)).toEqual([]);
});

test('another account signing in after a 401 never sees the previous account in memory', async () => {
  const w = world();
  const t = w.open();
  await signIn(t, alice);
  await load(t, ['issues', {}], { pages: [page(['alice-task'])], pageParams: [undefined] });
  await t.client
    .fetchQuery({
      queryKey: ['issue', 'gone'],
      queryFn: async () => {
        throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in');
      },
    })
    .catch(() => undefined);
  await t.cache.flush();
  expect(t.cache.getState().phase).toBe('signed-out');
  // The same tab signs in again as another account (the login page only refetches /me).
  await signIn(t, bob);
  expect(t.client.getQueryData(['issues', {}])).toBeUndefined();
  expect(t.client.getQueryData<typeof bob>(['me'])).toEqual(bob);
  t.detach();
});

test('sign-out clears the private cache in every open tab through BroadcastChannel', async () => {
  const w = world();
  const one = w.open(),
    two = w.open();
  await signIn(one);
  await signIn(two);
  await load(two, ['issues', {}], { pages: [page(['shared'])], pageParams: [undefined] });
  await one.cache.signOut();
  await stateChange(two, (state) => state.phase === 'signed-out');
  await dataCleared(two, ['issues', {}]);
  expect(two.cache.canWrite()).toBe(false);
  await two.cache.flush();
  one.detach();
  two.detach();
  expect(await rawRecords(w.idb)).toEqual([]);
});

test('sign-out reaches other tabs through the storage event when BroadcastChannel is unavailable', async () => {
  const events = new EventTarget(),
    values = new Map<string, string>();
  const storage = {
    setItem(key: string, value: string) {
      values.set(key, value);
      // Browsers deliver storage events to other documents of the same origin.
      events.dispatchEvent(Object.assign(new Event('storage'), { key, newValue: value }));
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
  const w = world({ broadcast: false });
  const one = w.open({ signalStorage: storage, signalEvents: new EventTarget() }),
    two = w.open({ signalStorage: storage, signalEvents: events });
  await signIn(one);
  await signIn(two);
  await one.cache.signOut();
  await stateChange(two, (state) => state.phase === 'signed-out');
  one.detach();
  two.detach();
});

test('a different account confirmed in another tab resets this tab instead of showing mixed data', async () => {
  const w = world();
  const one = w.open(),
    two = w.open();
  await signIn(one, alice);
  await signIn(two, alice);
  await load(two, ['issue', 'alice-only'], { id: 'alice-only' });
  // The shared cookie now belongs to Bob (e.g. signed in through another window).
  const reset = dataCleared(two, ['issue', 'alice-only']);
  await signIn(one, bob);
  await reset;
  expect(two.cache.canWrite()).toBe(false);
  one.detach();
  two.detach();
});

test('schema changes and entries older than the TTL are discarded, not rendered', async () => {
  let now = 1_000_000;
  const w = world({ now: () => now });
  const old = w.open({ schema: 0 });
  await signIn(old);
  await load(old, ['issue', 't1'], { id: 't1' });
  old.detach();
  const current = w.open();
  expect(await current.cache.restore(current.client)).toBe(0);
  expect(current.cache.getState().phase).toBe('cold');
  await signIn(current);
  await load(current, ['issue', 't2'], { id: 't2' });
  current.detach();
  now += READ_CACHE_TTL_MS + 1;
  const expired = w.open();
  expect(await expired.cache.restore(expired.client)).toBe(0);
  expect(expired.client.getQueryData(['issue', 't2'])).toBeUndefined();
  expired.detach();
  expect(await rawRecords(w.idb)).toEqual([]);
});

test('work stays bounded: long lists keep the first pages and old entries are evicted', async () => {
  const w = world({ limits: { entries: 4, pages: 2, entryChars: 1_000_000 } });
  const t = w.open();
  await signIn(t);
  for (const id of ['a', 'b', 'c', 'd', 'e']) await load(t, ['issue', id], { id });
  await t.client.fetchInfiniteQuery({
    queryKey: ['issues', {}],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const n = Number(pageParam ?? 0);
      return page(['p' + n], n < 5 ? String(n + 1) : null);
    },
    getNextPageParam: (last: { next_cursor: string | null }) => last.next_cursor ?? undefined,
    pages: 5,
  });
  await t.cache.flush();
  t.detach();
  expect(await rawRecords(w.idb)).toHaveLength(4);
  const next = w.open();
  await next.cache.restore(next.client);
  const list = next.client.getQueryData<{
    pages: { next_cursor: string }[];
    pageParams: unknown[];
  }>(['issues', {}]);
  // Only the first two pages are kept; the second page's cursor still drives Load more.
  expect(list?.pages).toHaveLength(2);
  expect(list?.pageParams).toHaveLength(2);
  expect(list?.pages[1].next_cursor).toBe('2');
  // Least recently saved entries were evicted first; the account entry never is.
  expect(next.client.getQueryData(['me'])).toMatchObject({ id: 'user-a' });
  expect(next.client.getQueryData(['issue', 'e'])).toMatchObject({ id: 'e' });
  expect(next.client.getQueryData(['issue', 'c'])).toBeUndefined();
  next.detach();
});

test('open tabs of one account share the eviction index, so the entry limit holds across tabs', async () => {
  const w = world({ limits: { entries: 3, pages: 5, entryChars: 1_000_000 } });
  const a = w.open(),
    b = w.open();
  await signIn(a);
  await signIn(b);
  // Interleaved saves: each tab must see the other's entries when it evicts.
  await load(a, ['issue', 'a1'], { id: 'a1' });
  await load(b, ['issue', 'b1'], { id: 'b1' });
  await load(a, ['issue', 'a2'], { id: 'a2' });
  await load(b, ['issue', 'b2'], { id: 'b2' });
  a.detach();
  b.detach();
  const hashes = (await rawRecords(w.idb)).map((row) => (row as { hash: string }).hash).sort();
  expect(hashes).toEqual(['["issue","a2"]', '["issue","b2"]', '["me"]']);
});

test('an oversize entry is skipped instead of filling storage', async () => {
  const w = world({ limits: { entries: 10, pages: 5, entryChars: 200 } });
  const t = w.open();
  await signIn(t);
  await load(t, ['issue', 'huge'], { id: 'huge', description: 'x'.repeat(500) });
  t.detach();
  expect(JSON.stringify(await rawRecords(w.idb))).not.toContain('huge');
});

test('quota exhaustion evicts older entries once, then turns persistence off explicitly', async () => {
  const w = world();
  const t = w.open();
  await signIn(t);
  for (const id of ['a', 'b', 'c']) await load(t, ['issue', id], { id });
  // oxlint-disable-next-line typescript/unbound-method -- called below with the store as `this`.
  const put = IDBObjectStore.prototype.put;
  let failures = 1;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
    if (failures-- > 0) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    return put.apply(this, args);
  };
  try {
    await load(t, ['issue', 'd'], { id: 'd' });
    expect(t.cache.getState().storage).toBe('ready');
    failures = 100;
    await load(t, ['issue', 'e'], { id: 'e' });
    expect(t.cache.getState().storage).toBe('full');
    // Browsing continues from memory; later writes are not attempted.
    await load(t, ['issue', 'f'], { id: 'f' });
    expect(t.client.getQueryData(['issue', 'f'])).toMatchObject({ id: 'f' });
  } finally {
    IDBObjectStore.prototype.put = put;
  }
  t.detach();
  const next = w.open();
  await next.cache.restore(next.client);
  expect(next.client.getQueryData(['issue', 'd'])).toMatchObject({ id: 'd' });
  expect(next.client.getQueryData(['issue', 'e'])).toBeUndefined();
  expect(next.client.getQueryData(['issue', 'f'])).toBeUndefined();
  next.detach();
});

test('denied or missing IndexedDB leaves an explicit state and never blocks sign-in', async () => {
  const denied = tab(
    {
      open() {
        throw new DOMException('Storage denied', 'SecurityError');
      },
    } as unknown as ReadCacheOptions['indexedDB'],
    'denied-' + crypto.randomUUID(),
  );
  expect(await denied.cache.restore(denied.client)).toBe(0);
  expect(denied.cache.getState().storage).toBe('denied');
  await signIn(denied);
  await load(denied, ['issue', 't1'], { id: 't1' });
  expect(denied.cache.canWrite()).toBe(true);
  denied.detach();
  const missing = tab(null, 'missing-' + crypto.randomUUID());
  expect(await missing.cache.restore(missing.client)).toBe(0);
  expect(missing.cache.getState().storage).toBe('unsupported');
  missing.detach();
});

test('offline, rate limiting and server errors keep the saved copy read-only with an explicit retry time', async () => {
  let now = 5_000_000;
  const w = world({ now: () => now });
  const t = w.open();
  await signIn(t);
  await load(t, ['issue', 't1'], { id: 't1' });
  t.detach();
  const next = w.open();
  await next.cache.restore(next.client);
  const fail = (error: Error) =>
    next.client
      .fetchQuery({
        queryKey: ['me'],
        queryFn: async () => {
          throw error;
        },
      })
      .catch(() => undefined);
  await fail(new ApiError(429, 'RATE_LIMITED', 'Slow down', undefined, 30_000));
  expect(next.cache.getState()).toMatchObject({
    phase: 'restored',
    problem: 'rate-limited',
    retryAt: now + 30_000,
  });
  // Backoff without Retry-After: 15 s, 30 s, 60 s, then every 120 s; the 429 above was step one.
  await fail(new ApiError(0, 'NETWORK_UNAVAILABLE', 'Offline'));
  expect(next.cache.getState()).toMatchObject({ problem: 'offline', retryAt: now + 30_000 });
  await fail(new ApiError(503, 'HTTP_ERROR', 'Down'));
  expect(next.cache.getState()).toMatchObject({ problem: 'server', retryAt: now + 60_000 });
  await fail(new ApiError(503, 'HTTP_ERROR', 'Down'));
  expect(next.cache.getState().retryAt).toBe(now + 120_000);
  await fail(new ApiError(503, 'HTTP_ERROR', 'Down'));
  expect(next.cache.getState().retryAt).toBe(now + 120_000);
  expect(next.cache.canWrite()).toBe(false);
  expect(next.client.getQueryData(['issue', 't1'])).toMatchObject({ id: 't1' });
  now += 1;
  await signIn(next);
  expect(next.cache.getState()).toMatchObject({ phase: 'live', problem: null, retryAt: null });
  next.detach();
});

test('the browser going offline is shown at once, and coming back online revalidates immediately', async () => {
  const w = world();
  const t = w.open();
  await signIn(t);
  await load(t, ['issue', 't1'], { id: 't1' });
  t.detach();
  const events = new EventTarget();
  let online = false,
    revalidations = 0;
  const next = w.open({ onlineEvents: events, online: () => online });
  next.client.setQueryDefaults(['me'], {
    queryFn: async () => {
      revalidations++;
      return alice;
    },
  });
  await next.cache.restore(next.client);
  expect(next.cache.getState()).toMatchObject({ phase: 'restored', problem: 'offline' });
  online = true;
  events.dispatchEvent(new Event('online'));
  await stateChange(next, (state) => state.phase === 'live');
  expect(revalidations).toBe(1);
  next.detach();
  // A restored copy that loses the connection before /me answers says so without waiting.
  const later = w.open({ onlineEvents: events });
  await later.cache.restore(later.client);
  expect(later.cache.getState().problem).toBeNull();
  events.dispatchEvent(new Event('offline'));
  expect(later.cache.getState().problem).toBe('offline');
  later.detach();
});
