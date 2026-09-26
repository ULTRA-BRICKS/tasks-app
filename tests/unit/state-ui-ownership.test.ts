import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
async function registry() {
  expect(existsSync('src/shared/lib/state/ui-registry.ts')).toBe(true);
  return import('../../src/shared/lib/state/ui-registry');
}
test('mounted UI values belong to one runtime and unmount releases their registry entries', async () => {
  const { createUiRegistry } = await registry(),
    root = createUiRegistry();
  const first = root.value('title', 'A'),
    second = root.value('menu', false);
  expect(root.inspect()).toEqual({});
  const releaseA = first.attach(),
    releaseB = second.attach();
  first.set('B');
  second.set(true);
  expect(root.inspect()).toEqual({ title: 'B', menu: true });
  releaseA();
  first.set('late');
  expect(root.inspect()).toEqual({ menu: true });
  const revive = first.attach();
  expect(first.getSnapshot()).toBe('B');
  revive();
  releaseB();
  expect(root.inspect()).toEqual({});
  root.dispose();
  expect(() => second.attach()).toThrow();
});
test('dependent UI changes are atomic and root registries are isolated', async () => {
  const { createUiRegistry } = await registry(),
    root = createUiRegistry(),
    other = createUiRegistry();
  const a = root.value('a', 0),
    b = root.value('b', 0);
  a.attach();
  b.attach();
  const seen: number[][] = [];
  const stop = a.subscribe(() => seen.push([a.getSnapshot(), b.getSnapshot()]));
  root.transact(() => {
    a.set(1);
    b.set(2);
  });
  expect(seen).toEqual([[1, 2]]);
  expect(other.inspect()).toEqual({});
  expect(() =>
    root.transact(() => {
      a.set(9);
      throw Error('abort');
    }),
  ).toThrow('abort');
  expect(a.getSnapshot()).toBe(1);
  stop();
  root.dispose();
  other.dispose();
});
