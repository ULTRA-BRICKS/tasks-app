import { test, expect } from 'bun:test';
import {
  observeExternal,
  sendText,
  settleText,
  type TextSync,
} from '../../src/shared/lib/synced-text.ts';

const idle = (external: string): TextSync => ({ external, inflight: [] });
function sendAll(start: TextSync, ...texts: string[]) {
  let sync = start;
  for (const text of texts) sync = sendText(sync, text) ?? sync;
  return sync;
}

test('sending text the URL already holds, or will hold, is a no-op', () => {
  expect(sendText(idle('abc'), 'abc')).toBeNull();
  expect(sendText(sendAll(idle(''), 'a'), 'a')).toBeNull();
  expect(sendText(idle('abc'), 'abcd')).toEqual({ external: 'abc', inflight: ['abcd'] });
});

test('the echo of a commit is never adopted', () => {
  const sent = sendAll(idle(''), 'fast');
  const { sync, adopt } = observeExternal(sent, 'fast');
  expect(adopt).toBe(false);
  expect(sync).toEqual({ external: 'fast', inflight: [] });
});

test('echoes arriving late, after newer commits were sent, are not adopted', () => {
  const sent = sendAll(idle(''), 'a', 'ab', 'abc');
  const first = observeExternal(sent, 'a');
  expect(first.adopt).toBe(false);
  const second = observeExternal(first.sync, 'ab');
  expect(second.adopt).toBe(false);
  const third = observeExternal(second.sync, 'abc');
  expect(third).toEqual({ adopt: false, sync: { external: 'abc', inflight: [] } });
});

test('only the newest of several batched echoes is observed', () => {
  const { sync, adopt } = observeExternal(sendAll(idle(''), 'a', 'ab', 'abc'), 'abc');
  expect(adopt).toBe(false);
  expect(sync.inflight).toEqual([]);
});

test('deleting back to the URL value still sends the removal', () => {
  const sent = sendAll(idle(''), 'a', '');
  expect(sent.inflight).toEqual(['a', '']);
  const afterA = observeExternal(sent, 'a');
  expect(afterA.adopt).toBe(false);
  const afterEmpty = observeExternal(afterA.sync, '');
  expect(afterEmpty).toEqual({ adopt: false, sync: { external: '', inflight: [] } });
});

test('a URL change nobody sent is adopted and forgets older commits', () => {
  const typing = sendAll(idle(''), 'abc');
  expect(observeExternal(typing, 'saved view')).toEqual({
    adopt: true,
    sync: { external: 'saved view', inflight: [] },
  });
  expect(observeExternal(idle('x'), '')).toEqual({ adopt: true, sync: idle('') });
});

test('an unchanged URL is not adopted', () => {
  const { sync, adopt } = observeExternal(idle('same'), 'same');
  expect(adopt).toBe(false);
  expect(sync).toEqual(idle('same'));
});

test('settling forgets commits that can no longer echo, so a later navigation to them is adopted', () => {
  const stale = sendAll(idle(''), 'a', '');
  expect(settleText(stale)).toEqual(idle(''));
  expect(observeExternal(settleText(stale), 'a').adopt).toBe(true);
});
