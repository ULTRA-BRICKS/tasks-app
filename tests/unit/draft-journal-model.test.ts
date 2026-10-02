import { test, expect } from 'bun:test';
import { draftPersistence } from '../../src/shared/lib/draft-persistence';

class FakeStore implements Storage {
  readonly entries = new Map<string, string>();
  get length() {
    return this.entries.size;
  }
  key(index: number) {
    return [...this.entries.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.entries.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.entries.set(key, value);
  }
  removeItem(key: string) {
    this.entries.delete(key);
  }
  clear() {
    this.entries.clear();
  }
}
function withStores(check: (persistent: FakeStore) => void) {
  const persistent = new FakeStore(),
    tab = new FakeStore();
  const saved = ['localStorage', 'sessionStorage'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  Object.defineProperty(globalThis, 'localStorage', { value: persistent, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: tab, configurable: true });
  try {
    check(persistent);
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test('actual journal writes keep sixty large submission receipts compact', () =>
  withStores((store) => {
    const key = 'input-draft:growth-workspace:growth-user:document';
    for (let i = 0; i < 60; i++) {
      draftPersistence.setItem(key, 'Synthetic document '.repeat(5000) + i);
      draftPersistence.removeItem(key);
    }
    const rows = [...store.entries.values()].map((value) => JSON.parse(value));
    const receipts = rows.filter((row) => row.value === null);
    expect(receipts).toHaveLength(60);
    expect(
      receipts.every(
        (row) => row.acknowledgedValue === undefined && typeof row.acknowledgedVersion === 'string',
      ),
    ).toBe(true);
    expect(Math.max(...rows.map((row) => Object.keys(row.clock).length))).toBe(1);
    expect(
      [...store.entries].reduce((sum, [key, value]) => sum + key.length + value.length, 0),
    ).toBeLessThan(200000);
    expect(draftPersistence.getItem(key)).toBeNull();
  }));

test('explicit removal affects only the selected account and workspace', () =>
  withStores(() => {
    const a = { id: 'alice', workspace_id: 'first' },
      b = { id: 'bob', workspace_id: 'first' };
    const keyA = 'input-draft:first:alice:comment',
      keyB = 'input-draft:first:bob:comment';
    draftPersistence.setItem(keyA, 'Synthetic Alice copy');
    draftPersistence.setItem(keyB, 'Synthetic Bob copy');
    expect(draftPersistence.hasLocalCopies(a)).toBe(true);
    draftPersistence.removeLocalCopies(a);
    expect(draftPersistence.list(a)).toHaveLength(0);
    expect(draftPersistence.getItem(keyB)).toBe('Synthetic Bob copy');
    expect(draftPersistence.list(b)).toHaveLength(1);
  }));

test('late submission receipt preserves a newer revision and its tab mirror', () =>
  withStores(() => {
    const owner = { id: 'late-reader', workspace_id: 'receipts' };
    const key = 'input-draft:receipts:late-reader:comment';
    draftPersistence.setItem(key, 'Submitted value');
    const submitted = draftPersistence.capture(key)!;
    draftPersistence.setItem(key, 'Newer unsent value');
    const newer = draftPersistence.capture(key)!;
    draftPersistence.acknowledge(submitted);
    expect(draftPersistence.getItem(key)).toBe('Newer unsent value');
    expect(draftPersistence.capture(key)?.valueVersion).toBe(newer.valueVersion);
    expect(JSON.parse(sessionStorage.getItem(key)!).value).toBe('Newer unsent value');
    expect(draftPersistence.list(owner).map((item) => item.value)).toEqual(['Newer unsent value']);
  }));

test('an explicit restore is a new unsent revision even after acknowledging the saved copy', () =>
  withStores(() => {
    const owner = { id: 'restore-reader', workspace_id: 'receipts' };
    const key = 'input-draft:receipts:restore-reader:comment';
    draftPersistence.setItem(key, 'Restore this exact content');
    const saved = draftPersistence.capture(key)!;
    draftPersistence.acknowledge(saved);
    draftPersistence.restore(saved, owner);
    expect(draftPersistence.capture(key)?.valueVersion).not.toBe(saved.valueVersion);
    expect(draftPersistence.list(owner).map((item) => item.value)).toEqual([
      'Restore this exact content',
    ]);
  }));
