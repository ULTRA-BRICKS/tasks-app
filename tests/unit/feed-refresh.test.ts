import { test, expect } from 'bun:test';
import { feedRefreshInterval } from '../../src/shared/lib/feed-refresh';
test('background refresh work stays bounded as loaded page count grows', () => {
  for (const pages of [1, 2, 3, 10, 20]) {
    expect(feedRefreshInterval(pages)).toBe(15000 * pages);
    expect((pages * 60000) / feedRefreshInterval(pages)).toBe(4);
  }
});
test('empty or malformed page counts retain a safe baseline interval', () => {
  expect(feedRefreshInterval(0)).toBe(15000);
  expect(feedRefreshInterval(Number.NaN)).toBe(15000);
  expect(feedRefreshInterval(-2)).toBe(15000);
});
