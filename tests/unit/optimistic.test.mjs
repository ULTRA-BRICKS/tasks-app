import { test, expect } from 'bun:test';
import { rollbackOptimistic } from '../../src/shared/lib/optimistic.ts';
test('rollback preserves unrelated pages, rows and later versions', () => {
  const original = { id: '1', version: 1, title: 'Original' };
  const unrelated = { id: '2', version: 5, title: 'Newer unrelated data' };
  const previous = {
    pages: [{ data: [original] }, { data: [{ ...unrelated, title: 'Old unrelated data' }] }],
  };
  const current = {
    pages: [{ data: [{ ...original, title: 'Optimistic' }] }, { data: [unrelated] }],
    pageParams: [null, 'cursor'],
  };
  const next = rollbackOptimistic(current, previous, '1', 1, { title: 'Optimistic' });
  expect(next.pages[0].data[0]).toBe(original);
  expect(next.pages[1]).toBe(current.pages[1]);
  expect(next.pages[1].data[0]).toBe(unrelated);
  expect(next.pageParams).toBe(current.pageParams);
  expect(current.pages[0].data[0].title).toBe('Optimistic');
  const newer = { pages: [{ data: [{ id: '1', version: 2, title: 'Remote' }] }] };
  expect(rollbackOptimistic(newer, previous, '1', 1, { title: 'Optimistic' })).toBe(newer);
});
test('rollback does not undo a newer optimistic patch or serialize unrelated rows', () => {
  const untouched = {
    id: 'other',
    version: 1,
    title: {
      toJSON() {
        throw new Error('Unrelated row was serialized');
      },
    },
  };
  const current = {
    pages: [{ data: [untouched, { id: 'target', version: 1, title: 'Second patch' }] }],
  };
  const previous = { pages: [{ data: [{ id: 'target', version: 1, title: 'Original' }] }] };
  expect(rollbackOptimistic(current, previous, 'target', 1, { title: 'First patch' })).toBe(
    current,
  );
  const result = rollbackOptimistic(current, previous, 'target', 1, { title: 'Second patch' });
  expect(result.pages[0].data[0]).toBe(untouched);
  expect(result.pages[0].data[1].title).toBe('Original');
  expect(rollbackOptimistic(current, previous, 'absent', 1, { title: 'x' })).toBe(current);
});

test('overlapping infinite pages roll back every matching copy, not a newer version', () => {
  const old = { id: 'i', version: 1, title: 'Old' },
    optimistic = { ...old, title: 'Pending' },
    newer = { id: 'i', version: 2, title: 'Newer' };
  const previous = { pages: [{ data: [old] }, { data: [old, newer] }] };
  const current = { pages: [{ data: [optimistic] }, { data: [optimistic, newer] }] };
  const next = rollbackOptimistic(current, previous, 'i', 1, { title: 'Pending' });
  expect(next.pages[0].data[0]).toBe(old);
  expect(next.pages[1].data[0]).toBe(old);
  expect(next.pages[1].data[1]).toBe(newer);
});
