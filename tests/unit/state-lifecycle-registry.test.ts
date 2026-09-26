import { expect, test } from 'bun:test';
import { createUiRegistry } from '../../src/shared/lib/state/ui-registry';

// Disproven hypothesis: an entry removed by a StrictMode cleanup is not restored.
test('attach, detach, re-attach restores the registry entry with its value', () => {
  const registry = createUiRegistry();
  const owner = registry.value('/ui/a', 1);
  const detach = owner.attach();
  owner.set(2);
  detach();
  expect(registry.inspect()).toEqual({});
  owner.attach();
  expect(registry.inspect()).toEqual({ '/ui/a': 2 });
  registry.dispose();
});

// Disproven hypothesis: a setter captured before detach writes to the old owner.
test('a detached owner ignores stale setters; a pre-attach write is allowed', () => {
  const registry = createUiRegistry();
  const owner = registry.value('/ui/a', 'seed');
  owner.set('before-attach');
  expect(owner.getSnapshot()).toBe('before-attach');
  const detach = owner.attach();
  detach();
  owner.set('stale');
  owner.update(() => 'stale-updater');
  expect(owner.getSnapshot()).toBe('before-attach');
  registry.dispose();
});

// Order React uses when useMemo's cache is discarded: the replacement entry is
// created during render while the old one is still attached, then swapped at commit.
test('a discarded memo cache keeps the user value for the same owner id', () => {
  const registry = createUiRegistry();
  const first = registry.value('/ui/a', 'seed');
  const detachFirst = first.attach();
  first.set('typed by user');
  const second = registry.value('/ui/a', 'seed');
  detachFirst();
  second.attach();
  expect(second.getSnapshot()).toBe('typed by user');
  expect(registry.inspect()).toEqual({ '/ui/a': 'typed by user' });
  registry.dispose();
});

test('a fully unmounted owner id starts fresh on remount, like useState', () => {
  const registry = createUiRegistry();
  const first = registry.value('/ui/a', 'seed');
  const detach = first.attach();
  first.set('typed');
  detach();
  const second = registry.value('/ui/a', 'seed');
  second.attach();
  expect(second.getSnapshot()).toBe('seed');
  registry.dispose();
});
