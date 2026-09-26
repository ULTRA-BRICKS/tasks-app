import { expect, test } from 'bun:test';
import {
  createKeyboardController,
  type KeyEventLike,
  type KeyboardPorts,
} from '../../src/features/keyboard/controller';
import { navigationChords } from '../../src/shared/lib/shortcuts';

function key(k: string, extra: Partial<KeyEventLike> = {}) {
  const calls = { prevented: 0, stopped: 0 };
  const event: KeyEventLike = {
    key: k,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    preventDefault: () => void calls.prevented++,
    stopPropagation: () => void calls.stopped++,
    ...extra,
  };
  return { event, calls };
}
function harness(over: Partial<KeyboardPorts> = {}) {
  const log = {
    navigate: [] as Array<[string, unknown]>,
    search: 0,
    focused: [] as number[],
    toggled: 0,
  };
  let time = 1000;
  let active = -1;
  const ports: KeyboardPorts = {
    now: () => time,
    navigate: (path, options) => void log.navigate.push([path, options]),
    location: () => ({ pathname: '/issues', search: '?a=1', from: undefined }),
    role: () => 'member',
    openSearch: () => void log.search++,
    guard: () => false,
    overlayOpen: () => false,
    rows: {
      count: () => 3,
      activeIndex: () => active,
      focusAt: (i) => {
        active = i;
        log.focused.push(i);
      },
      toggleActive: () => {
        log.toggled++;
        return true;
      },
    },
    ...over,
  };
  const controller = createKeyboardController(ports);
  return { controller, log, advance: (ms: number) => void (time += ms) };
}

test('g then i navigates; the chord expires after one second', () => {
  const { controller, log, advance } = harness();
  controller.handle(key('g').event);
  controller.handle(key('i').event);
  expect(log.navigate).toEqual([[navigationChords.i, undefined]]);
  controller.handle(key('g').event);
  advance(1001);
  controller.handle(key('i').event);
  expect(log.navigate).toHaveLength(1);
  controller.dispose();
});

test('a route change clears a pending chord', () => {
  const { controller, log } = harness();
  controller.handle(key('g').event);
  controller.reset();
  controller.handle(key('m').event);
  expect(log.navigate).toEqual([]);
  controller.dispose();
});

test('command search works while an editor has focus but not over an open dialog', () => {
  const guarded = harness({ guard: () => true });
  const meta = key('k', { metaKey: true });
  guarded.controller.handle(meta.event);
  expect(guarded.log.search).toBe(1);
  expect(meta.calls).toEqual({ prevented: 1, stopped: 1 });
  const blocked = harness({ overlayOpen: () => true });
  blocked.controller.handle(key('k', { ctrlKey: true }).event);
  expect(blocked.log.search).toBe(0);
  const composing = harness();
  composing.controller.handle(key('k', { ctrlKey: true, isComposing: true }).event);
  expect(composing.log.search).toBe(0);
});

test('C creates with a return path, except for viewers and key repeats', () => {
  const member = harness();
  member.controller.handle(key('c').event);
  expect(member.log.navigate).toEqual([['/issues/new', { state: { from: '/issues?a=1' } }]]);
  const viewer = harness({ role: () => 'viewer' });
  viewer.controller.handle(key('v').event);
  expect(viewer.log.navigate).toEqual([]);
  const repeat = harness();
  repeat.controller.handle(key('c', { repeat: true }).event);
  expect(repeat.log.navigate).toEqual([]);
});

test('question mark opens help through the store; guard suppresses plain keys', () => {
  const { controller } = harness();
  const seen: boolean[] = [];
  const stop = controller.help.subscribe(() => seen.push(controller.help.getSnapshot()));
  controller.handle(key('?').event);
  expect(seen).toEqual([true]);
  controller.setHelp(false);
  expect(seen).toEqual([true, false]);
  stop();
  const guarded = harness({ guard: () => true });
  guarded.controller.handle(key('c').event);
  expect(guarded.log.navigate).toEqual([]);
  guarded.controller.dispose();
});

test('Escape returns from an issue page to the remembered list route', () => {
  const remembered = harness({
    location: () => ({ pathname: '/issues/abc', search: '', from: '/my-issues?x=1' }),
  });
  remembered.controller.handle(key('Escape').event);
  expect(remembered.log.navigate).toEqual([['/my-issues?x=1', undefined]]);
  const fallback = harness({
    location: () => ({ pathname: '/issues/abc', search: '', from: undefined }),
  });
  fallback.controller.handle(key('Escape').event);
  expect(fallback.log.navigate).toEqual([['/issues', undefined]]);
  const elsewhere = harness();
  elsewhere.controller.handle(key('Escape').event);
  expect(elsewhere.log.navigate).toEqual([]);
});

test('J/K walk visible rows and clamp; X toggles the focused row', () => {
  const { controller, log } = harness();
  controller.handle(key('j').event);
  controller.handle(key('j').event);
  controller.handle(key('arrowdown').event);
  controller.handle(key('arrowdown').event);
  controller.handle(key('k').event);
  expect(log.focused).toEqual([0, 1, 2, 2, 1]);
  controller.handle(key('x').event);
  expect(log.toggled).toBe(1);
  const upFromNothing = harness();
  upFromNothing.controller.handle(key('k').event);
  expect(upFromNothing.log.focused).toEqual([2]);
});

test('modifier combinations other than search are ignored; disposed controllers are inert', () => {
  const { controller, log } = harness();
  controller.handle(key('c', { metaKey: true }).event);
  expect(log.navigate).toEqual([]);
  controller.dispose();
  controller.handle(key('c').event);
  expect(log.navigate).toEqual([]);
});
