import { expect, test } from 'bun:test';
import { advanceClock, followsClock, sameClock } from '../../src/shared/lib/draft-version';

test('a copy advances without changing its ancestor', () => {
  const original = { tabA: 1 };
  expect(advanceClock(original, 'tabA')).toEqual({ tabA: 2 });
  expect(original).toEqual({ tabA: 1 });
});
test('a submitted adopted copy supersedes precisely its ancestor', () => {
  const original = { tabA: 1 };
  const acknowledgement = advanceClock(original, 'tabB');
  expect(followsClock(acknowledgement, original)).toBe(true);
  expect(followsClock(original, acknowledgement)).toBe(false);
});
test('independent tabs remain incomparable', () => {
  expect(followsClock({ tabA: 8 }, { tabB: 1 })).toBe(false);
  expect(followsClock({ tabB: 1 }, { tabA: 8 })).toBe(false);
});
test('acknowledging an ancestor does not discard another tabs later edit', () => {
  const origin = { tabA: 1 };
  const edited = advanceClock(origin, 'tabC');
  const acknowledged = advanceClock(origin, 'tabB');
  expect(followsClock(acknowledged, edited)).toBe(false);
  expect(followsClock(edited, acknowledged)).toBe(false);
});
test('equal clocks are equal regardless of entry order and never supersede each other', () => {
  const a = { tabA: 2, tabB: 3 },
    b = { tabB: 3, tabA: 2 };
  expect(sameClock(a, b)).toBe(true);
  expect(followsClock(a, b)).toBe(false);
  expect(sameClock(a, { tabA: 2 })).toBe(false);
});
test('a descendant remains ordered through several adoptions', () => {
  const first = { tabA: 1 };
  const second = advanceClock(first, 'tabB');
  const third = advanceClock(second, 'tabC');
  expect(followsClock(third, first)).toBe(true);
  expect(followsClock(third, second)).toBe(true);
  expect(followsClock(advanceClock(first, 'tabA'), third)).toBe(false);
});
test('a counter overflow is rejected instead of silently losing ordering', () => {
  expect(() => advanceClock({ tabA: Number.MAX_SAFE_INTEGER }, 'tabA')).toThrow(
    'counter exhausted',
  );
});
