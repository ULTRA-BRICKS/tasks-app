import { expect, test } from 'bun:test';
import { StateError } from '@ultrabricks/state-lib';
import { createScope } from '../../src/shared/lib/state/scope';

const tick = () => new Promise<void>((done) => queueMicrotask(done));

test('scope values publish one notification per committed change and freeze nothing implicitly', () => {
  const scope = createScope();
  const open = scope.value(false);
  const seen: boolean[] = [];
  const stop = open.subscribe(() => seen.push(open.getSnapshot()));
  open.set(true);
  open.set(true); // Equal write: no notification.
  open.update((previous) => !previous);
  expect(seen).toEqual([true, false]);
  stop();
  scope.dispose();
});

test('a scope disposes its whole graph and rejects later writes', () => {
  const scope = createScope();
  const store = scope.value(1);
  scope.dispose();
  expect(() => store.set(2)).toThrow(StateError);
  expect(() => scope.dispose()).not.toThrow();
});

test('transact commits several stores as one notification wave', () => {
  const scope = createScope();
  const a = scope.value(1);
  const b = scope.value('x');
  let waves = 0;
  const stopA = a.subscribe(() => waves++);
  const stopB = b.subscribe(() => waves++);
  scope.transact(() => {
    a.set(2);
    b.set('y');
  });
  expect(a.getSnapshot()).toBe(2);
  expect(b.getSnapshot()).toBe('y');
  expect(waves).toBe(2); // Each observer notified once, never a torn intermediate.
  stopA();
  stopB();
  scope.dispose();
});

test('StrictMode replay: deactivate then activate keeps the scope alive', async () => {
  const scope = createScope();
  const store = scope.value('kept');
  scope.activate();
  scope.deactivate(); // Simulated effect cleanup
  scope.activate(); // Simulated effect replay
  await tick();
  await tick();
  expect(scope.disposed).toBe(false);
  expect(store.getSnapshot()).toBe('kept');
  scope.deactivate();
  await tick();
  await tick();
  expect(scope.disposed).toBe(true);
});

test('deactivate revokes authority immediately, before disposal completes', async () => {
  const scope = createScope();
  scope.activate();
  const before = scope.generation;
  scope.deactivate();
  expect(scope.isCurrent(before)).toBe(false);
  scope.activate();
  expect(scope.isCurrent(before)).toBe(false); // Old async work never regains authority.
  expect(scope.isCurrent(scope.generation)).toBe(true);
  scope.dispose();
});

test('opaque resources stay outside serializable state and are released with the scope', () => {
  const scope = createScope();
  const editorHandle = { destroyed: false };
  const slot = scope.resource(editorHandle, (handle) => {
    handle.destroyed = true;
  });
  expect(slot.get()).toBe(editorHandle);
  expect(JSON.stringify(scope.value({ ok: true }).getSnapshot())).toBe('{"ok":true}');
  scope.dispose();
  expect(editorHandle.destroyed).toBe(true);
  expect(() => slot.get()).toThrow();
  scope.dispose();
  expect(editorHandle.destroyed).toBe(true);
});
