import { test, expect } from 'bun:test';
import {
  acknowledgesCopy,
  copyIdentity,
  receiptFor,
  receiptIdentity,
} from '../../src/shared/lib/draft-receipt';
import { advanceClock } from '../../src/shared/lib/draft-version';

test('a receipt identifies one submitted revision and contains no sent body', () => {
  const copy = { value: 'Synthetic body '.repeat(7000), valueVersion: 'copy-one' };
  const receipt = receiptFor(copy);
  expect(receipt).toEqual({ acknowledgedVersion: 'copy-one' });
  expect(JSON.stringify(receipt).length).toBeLessThan(100);
  expect(acknowledgesCopy(receipt, copy)).toBe(true);
  expect(acknowledgesCopy(receipt, { ...copy, valueVersion: 'copy-two' })).toBe(false);
});

test('legacy receipts remain distinct from new versioned copies', () => {
  const copy = { value: 'Legacy synthetic body' };
  const receipt = receiptFor(copy);
  expect(acknowledgesCopy(receipt, copy)).toBe(true);
  expect(acknowledgesCopy(receipt, { ...copy, valueVersion: 'new-copy' })).toBe(false);
  expect(copyIdentity({ value: null })).toBeNull();
  expect(receiptIdentity({})).toBeNull();
  expect(receiptFor({ value: null })).toEqual({});
});

test('repeated submission metadata grows linearly, without extra clock actors', () => {
  let clock = {};
  const receipts: unknown[] = [];
  for (let i = 0; i < 100; i++) {
    clock = advanceClock(clock, 'same-page');
    const copy = { value: 'Large synthetic body '.repeat(5000), valueVersion: 'copy-' + i };
    clock = advanceClock(clock, 'same-page');
    receipts.push({ ...receiptFor(copy), clock });
  }
  expect(Object.keys(clock)).toEqual(['same-page']);
  expect(JSON.stringify(receipts).length).toBeLessThan(10000);
  expect(JSON.stringify(receipts)).not.toContain('Large synthetic body');
});
