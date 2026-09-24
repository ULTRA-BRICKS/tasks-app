import { test, expect } from 'bun:test';
import {
  initialFeed,
  refreshFeed,
  revealNext,
  acceptFeed,
  appendRequestedPage,
} from '../../src/shared/lib/live-feed';
const item = (id: string, version = 1, status_id = 'todo') => ({
  id,
  version,
  status_id,
  title: id + ' v' + version,
});
test('new arrivals and regrouping never move existing rows until reviewed', () => {
  const initial = initialFeed([item('a'), item('b')]);
  const next = refreshFeed(initial, [item('new'), item('b', 2, 'done'), item('a', 2)]);
  expect(next.visible.map((row) => row.id)).toEqual(['a', 'b']);
  expect(next.added).toBe(1);
  expect(next.groups.b).toBe('todo');
  expect(next.queue).toHaveLength(2);
  const first = revealNext(next);
  expect(first.visible.filter((row) => row.version === 2)).toHaveLength(1);
  expect(first.visible.map((row) => row.id)).toEqual(['a', 'b']);
  const accepted = acceptFeed(first);
  expect(accepted.visible.map((row) => row.id)).toEqual(['new', 'b', 'a']);
  expect(accepted.groups.b).toBe('done');
});
test('disappearing rows retain their slot until review; duplicate pages and old versions do not regress data', () => {
  const initial = initialFeed([item('a', 3), item('b')]);
  const next = refreshFeed(initial, [item('a', 2), item('a', 3)]);
  expect(next.visible).toHaveLength(2);
  expect(next.departed).toEqual(['b']);
  const accepted = acceptFeed(next);
  expect(accepted.visible).toHaveLength(1);
  expect(accepted.visible[0].version).toBe(3);
});
test('bursts coalesce to the newest revision and unchanged refreshes do not animate', () => {
  const initial = initialFeed([item('a')]);
  expect(refreshFeed(initial, [item('a')]).queue).toHaveLength(0);
  const first = refreshFeed(initial, [item('a', 2)]),
    last = refreshFeed(first, [item('a', 4)]);
  expect(last.queue).toEqual(['a']);
  expect(revealNext(last).visible[0].version).toBe(4);
});

test('a changed row that later departs is not counted twice in the update badge', () => {
  const initial = initialFeed([item('a'), item('b')]);
  const changed = revealNext(refreshFeed(initial, [item('a', 2), item('b')]));
  const departed = refreshFeed(changed, [item('b')]);
  expect(departed.changed).toEqual([]);
  expect(departed.departed).toEqual(['a']);
});

test('explicit next-page records appear while unrelated live arrivals remain behind the badge', () => {
  const initial = initialFeed([item('a')]);
  const pending = refreshFeed(initial, [item('incoming'), item('a'), item('older')]);
  const expanded = appendRequestedPage(pending, [item('older')]);
  expect(expanded.visible.map((row) => row.id)).toEqual(['a', 'older']);
  expect(expanded.added).toBe(1);
  expect(expanded.latest.map((row) => row.id)).toEqual(['incoming', 'a', 'older']);
});
