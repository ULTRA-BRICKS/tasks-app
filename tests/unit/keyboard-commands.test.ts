import { describe, expect, test } from 'bun:test';
import {
  ariaKeyShortcuts,
  checkBinding,
  commandAvailable,
  createKeymap,
  detectPlatform,
  escapeLayer,
  eventToCombo,
  findConflicts,
  formatBinding,
  idleMatch,
  keycapLabels,
  matchShortcut,
  normalizeBinding,
  paletteCommands,
  parseBinding,
  reservedReason,
  spokenBinding,
  type KeyEventLike,
  type MatchState,
  type Platform,
} from '../../src/shared/lib/commands';
import { workspaceCommands } from '../../src/shared/lib/command-catalog';

const codes: Record<string, string> = { '?': 'Slash', '/': 'Slash', ' ': 'Space' };
function key(value: string, init: Partial<KeyEventLike> = {}): KeyEventLike {
  const code =
    codes[value] ??
    (/^[a-z]$/i.test(value)
      ? `Key${value.toUpperCase()}`
      : /^\d$/.test(value)
        ? `Digit${value}`
        : value);
  return {
    key: value,
    code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    keyCode: 0,
    ...init,
  };
}
const combo = (event: KeyEventLike, platform: Platform) => {
  const value = eventToCombo(event, platform);
  return value ? formatBinding([value]) : null;
};
const command = (id: string) => {
  const found = workspaceCommands.find((c) => c.id === id);
  if (!found) throw new Error(`missing command ${id}`);
  return found;
};

describe('parse', () => {
  test('bindings normalize to one canonical text', () => {
    expect(normalizeBinding('mod+k')).toBe('Mod+K');
    expect(normalizeBinding('Shift+Mod+z')).toBe('Mod+Shift+Z');
    expect(normalizeBinding('alt+shift+mod+p')).toBe('Mod+Alt+Shift+P');
    expect(normalizeBinding('g i')).toBe('G I');
    expect(normalizeBinding('?')).toBe('?');
    expect(normalizeBinding('Mod+/')).toBe('Mod+/');
    expect(normalizeBinding('shift+arrowdown')).toBe('Shift+ArrowDown');
    expect(normalizeBinding('Esc')).toBe('Escape');
    expect(normalizeBinding('space')).toBe('Space');
  });
  test('invalid, ambiguous and over-long bindings are rejected', () => {
    for (const text of [
      '',
      ' ',
      'Shift+/',
      'Shift+?',
      'Hyper+K',
      'Meta+K',
      'Mod+',
      'Mod+Shift',
      'G I J',
      'Mod+Foo',
      'Mod+Mod+K',
    ])
      expect(parseBinding(text)).toBeNull();
  });
});

describe('events', () => {
  test('Mod is Command on Mac and Control elsewhere', () => {
    expect(combo(key('k', { metaKey: true }), 'mac')).toBe('Mod+K');
    expect(combo(key('k', { ctrlKey: true }), 'other')).toBe('Mod+K');
    expect(combo(key('z', { metaKey: true, shiftKey: true }), 'mac')).toBe('Mod+Shift+Z');
    expect(combo(key('Z', { ctrlKey: true, shiftKey: true }), 'other')).toBe('Mod+Shift+Z');
  });
  test('platform-owned modifiers and AltGr text never match', () => {
    expect(combo(key('k', { ctrlKey: true }), 'mac')).toBeNull();
    expect(combo(key('k', { metaKey: true }), 'other')).toBeNull();
    expect(combo(key('ą', { ctrlKey: true, altKey: true, code: 'KeyA' }), 'other')).toBeNull();
  });
  test('Option and non-Latin layouts fall back to the physical letter', () => {
    expect(combo(key('˚', { altKey: true, code: 'KeyK' }), 'mac')).toBe('Alt+K');
    expect(combo(key('Dead', { altKey: true, code: 'KeyE' }), 'mac')).toBe('Alt+E');
    expect(combo(key('л', { code: 'KeyK' }), 'mac')).toBe('K');
    expect(combo(key('Л', { code: 'KeyK', shiftKey: true }), 'other')).toBe('Shift+K');
    expect(combo(key('л', { code: 'KeyK', metaKey: true }), 'mac')).toBe('Mod+K');
  });
  test('non-Latin digits fall back to the physical digit', () => {
    expect(combo(key('٣', { code: 'Digit3' }), 'other')).toBe('3');
    expect(combo(key('٣', { code: 'Digit3', ctrlKey: true }), 'other')).toBe('Mod+3');
    // A Latin-layout character on a digit key stays itself (AZERTY "&" is not "1").
    expect(combo(key('&', { code: 'Digit1' }), 'other')).toBe('&');
  });
  test('shifted punctuation keeps its character; named keys keep Shift', () => {
    expect(combo(key('?', { shiftKey: true }), 'mac')).toBe('?');
    expect(combo(key('/', { metaKey: true }), 'mac')).toBe('Mod+/');
    expect(combo(key('ArrowDown', { shiftKey: true }), 'other')).toBe('Shift+ArrowDown');
    expect(combo(key(' '), 'other')).toBe('Space');
    expect(combo(key('Escape'), 'mac')).toBe('Escape');
  });
  test('IME composition and modifier-only presses never match', () => {
    expect(combo(key('k', { isComposing: true }), 'mac')).toBeNull();
    expect(combo(key('Process', { code: 'KeyK' }), 'other')).toBeNull();
    expect(combo(key('k', { keyCode: 229 }), 'other')).toBeNull();
    for (const modifier of ['Shift', 'Meta', 'Control', 'Alt', 'CapsLock', 'AltGraph'])
      expect(combo(key(modifier, { shiftKey: modifier === 'Shift' }), 'mac')).toBeNull();
    expect(combo(key('Unidentified', { code: 'Backquote' }), 'mac')).toBeNull();
  });
});

describe('matching', () => {
  const run = (
    platform: Platform,
    presses: Array<[string, Partial<KeyEventLike>?, number?]>,
    textEntry = false,
  ) => {
    const keymap = createKeymap(workspaceCommands, {}, platform);
    let state: MatchState = idleMatch;
    const results: Array<string | null> = [];
    for (const [value, init, now = 0] of presses) {
      const next = eventToCombo(key(value, init), platform);
      if (!next) {
        results.push(null);
        continue;
      }
      const result = matchShortcut(keymap, state, next, { textEntry }, now);
      state = result.state;
      results.push(result.commandId ?? (result.pending ? 'pending' : null));
    }
    return results;
  };
  test('plain keys dispatch outside text entry', () => {
    expect(run('mac', [['c']])).toEqual(['task.create']);
    expect(run('mac', [['x']])).toEqual(['selection.toggle']);
    expect(run('mac', [['?', { shiftKey: true }]])).toEqual(['help.open']);
    expect(run('mac', [['z', { metaKey: true }]])).toEqual(['edit.undo']);
  });
  test('text entry keeps typing and native undo; only allowed modifier commands fire', () => {
    expect(run('mac', [['c'], ['x'], ['?', { shiftKey: true }], ['g'], ['i']], true)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(run('mac', [['z', { metaKey: true }]], true)).toEqual([null]);
    expect(run('other', [['y', { ctrlKey: true }]], true)).toEqual([null]);
    expect(run('mac', [['k', { metaKey: true }]], true)).toEqual(['palette.open']);
    expect(run('other', [['/', { ctrlKey: true }]], true)).toEqual(['help.open']);
  });
  test('sequences resolve within one second and unknown second keys fall through', () => {
    expect(run('mac', [['g'], ['i', {}, 500]])).toEqual(['pending', 'nav.tasks']);
    expect(run('mac', [['g'], ['i', {}, 1500]])).toEqual(['pending', null]);
    expect(run('mac', [['g'], ['x', {}, 200]])).toEqual(['pending', 'selection.toggle']);
    expect(run('mac', [['g'], ['g', {}, 200], ['s', {}, 400]])).toEqual([
      'pending',
      'pending',
      'nav.settings',
    ]);
  });
  test('redo follows each platform convention', () => {
    expect(run('mac', [['z', { metaKey: true, shiftKey: true }]])).toEqual(['edit.redo']);
    expect(run('mac', [['y', { metaKey: true }]])).toEqual([null]);
    expect(run('other', [['y', { ctrlKey: true }]])).toEqual(['edit.redo']);
    expect(run('other', [['z', { ctrlKey: true, shiftKey: true }]])).toEqual(['edit.redo']);
  });
  test('user overrides replace the defaults of that command', () => {
    const keymap = createKeymap(workspaceCommands, { 'task.create': ['Shift+N'] }, 'mac');
    const press = (value: string, init: Partial<KeyEventLike> = {}) => {
      const next = eventToCombo(key(value, init), 'mac');
      return next
        ? matchShortcut(keymap, idleMatch, next, { textEntry: false }, 0).commandId
        : null;
    };
    expect(press('c')).toBeUndefined();
    expect(press('N', { shiftKey: true })).toBe('task.create');
    const removed = createKeymap(workspaceCommands, { 'task.create': [] }, 'mac');
    const plain = eventToCombo(key('c'), 'mac');
    expect(
      plain && matchShortcut(removed, idleMatch, plain, { textEntry: false }, 0).commandId,
    ).toBeUndefined();
  });
});

describe('conflicts', () => {
  test('equal and prefix bindings conflict; the command keeps its own binding', () => {
    expect(checkBinding(workspaceCommands, {}, 'mac', 'nav.inbox', 'X')).toEqual({
      kind: 'conflict',
      commandId: 'selection.toggle',
    });
    expect(checkBinding(workspaceCommands, {}, 'mac', 'task.create', 'G')).toMatchObject({
      kind: 'conflict',
      commandId: 'nav.tasks',
    });
    expect(checkBinding(workspaceCommands, {}, 'mac', 'nav.inbox', 'C I')).toEqual({
      kind: 'conflict',
      commandId: 'task.create',
    });
    expect(checkBinding(workspaceCommands, {}, 'mac', 'nav.inbox', 'Escape')).toEqual({
      kind: 'conflict',
      commandId: 'layer.dismiss',
    });
    expect(checkBinding(workspaceCommands, {}, 'mac', 'task.create', 'C')).toBeNull();
    expect(checkBinding(workspaceCommands, {}, 'mac', 'nav.inbox', 'Shift+I')).toBeNull();
  });
  test('an override that frees a key lets another command take it', () => {
    const overrides = { 'selection.toggle': ['Shift+X'] };
    expect(checkBinding(workspaceCommands, overrides, 'mac', 'nav.inbox', 'X')).toBeNull();
  });
  test('invalid and fixed bindings are reported', () => {
    expect(checkBinding(workspaceCommands, {}, 'mac', 'nav.inbox', 'Shift+/')).toEqual({
      kind: 'invalid',
    });
    expect(checkBinding(workspaceCommands, {}, 'mac', 'layer.dismiss', 'Shift+D')).toEqual({
      kind: 'fixed',
    });
    expect(checkBinding(workspaceCommands, {}, 'mac', 'missing.command', 'Shift+D')).toEqual({
      kind: 'unknown',
    });
  });
  test('findConflicts lists every command sharing a binding', () => {
    expect(findConflicts(workspaceCommands, { 'nav.inbox': ['X'] }, 'mac')).toEqual([
      { binding: 'X', commandIds: ['nav.inbox', 'selection.toggle'] },
    ]);
    expect(findConflicts(workspaceCommands, { 'task.create': ['G'] }, 'other')).toEqual([
      {
        binding: 'G',
        commandIds: [
          'task.create',
          'nav.tasks',
          'nav.my-tasks',
          'nav.projects',
          'nav.cycles',
          'nav.inbox',
          'nav.settings',
        ],
      },
    ]);
  });
});

describe('reserved', () => {
  const reserved = (text: string, platform: Platform) => {
    const binding = parseBinding(text);
    if (!binding) throw new Error(text);
    return reservedReason(binding, platform);
  };
  test('browser and OS combos are reserved with a reason', () => {
    for (const platform of ['mac', 'other'] as const) {
      expect(reserved('Mod+W', platform)).toContain('tab');
      expect(reserved('Mod+T', platform)).not.toBeNull();
      expect(reserved('Mod+Shift+T', platform)).not.toBeNull();
      expect(reserved('Mod+R', platform)).not.toBeNull();
      expect(reserved('Mod+L', platform)).not.toBeNull();
      expect(reserved('Mod+C', platform)).not.toBeNull();
      expect(reserved('Mod+V', platform)).not.toBeNull();
      expect(reserved('Mod+A', platform)).not.toBeNull();
      expect(reserved('Mod+1', platform)).not.toBeNull();
      expect(reserved('Tab', platform)).not.toBeNull();
      expect(reserved('Shift+Tab', platform)).not.toBeNull();
      expect(reserved('Enter', platform)).not.toBeNull();
      expect(reserved('Mod+Shift+K', platform)).toBeNull();
    }
    expect(reserved('Mod+Q', 'mac')).not.toBeNull();
    expect(reserved('Mod+Q', 'other')).toBeNull();
    expect(reserved('Mod+Space', 'mac')).not.toBeNull();
    expect(reserved('Alt+F4', 'other')).not.toBeNull();
    expect(reserved('Alt+F4', 'mac')).toBeNull();
    expect(reserved('Alt+ArrowLeft', 'other')).not.toBeNull();
    expect(reserved('Mod+[', 'mac')).not.toBeNull();
  });
  test('checkBinding reports reserved before conflicts', () => {
    expect(checkBinding(workspaceCommands, {}, 'mac', 'nav.inbox', 'Mod+W')).toMatchObject({
      kind: 'reserved',
    });
  });
});

describe('catalog', () => {
  test('ids are unique and defaults are valid, unreserved and conflict-free on both platforms', () => {
    const ids = workspaceCommands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const platform of ['mac', 'other'] as const) {
      expect(findConflicts(workspaceCommands, {}, platform)).toEqual([]);
      for (const c of workspaceCommands)
        for (const text of c.keys[platform]) {
          const binding = parseBinding(text);
          expect(binding).not.toBeNull();
          // Focused-row commands document keys the focused control owns (Enter, Space).
          if (binding && c.target !== 'focused')
            expect(reservedReason(binding, platform)).toBeNull();
          expect(binding && formatBinding(binding)).toBe(text);
        }
    }
  });
});

describe('focused', () => {
  test('focused-row keys are listed and fixed, and never enter the global keymap', () => {
    const listed = [
      ['task.open', 'Enter'],
      ['task.peek', 'Space'],
      ['menu.context', 'Shift+F10'],
    ] as const;
    for (const [id, binding] of listed) {
      expect(command(id)).toMatchObject({
        target: 'focused',
        fixed: true,
        keys: { mac: [binding], other: [binding] },
      });
      for (const platform of ['mac', 'other'] as const)
        expect(createKeymap(workspaceCommands, {}, platform).single.has(binding)).toBe(false);
    }
  });
  test('no other command can take a focused-row key', () => {
    expect(checkBinding(workspaceCommands, {}, 'other', 'nav.inbox', 'Shift+F10')).toEqual({
      kind: 'conflict',
      commandId: 'menu.context',
    });
  });
});

describe('palette', () => {
  test('the palette offers the commands that act without keyboard focus, in catalog order', () => {
    expect(paletteCommands(workspaceCommands).map((c) => c.id)).toEqual([
      'help.open',
      'task.create',
      'nav.tasks',
      'nav.my-tasks',
      'nav.projects',
      'nav.cycles',
      'nav.inbox',
      'nav.settings',
      'edit.undo',
      'edit.redo',
    ]);
  });
});

describe('display', () => {
  const caps = (text: string, platform: Platform) => {
    const binding = parseBinding(text);
    if (!binding) throw new Error(text);
    return { caps: keycapLabels(binding, platform), spoken: spokenBinding(binding, platform) };
  };
  test('Mac shows symbols in Apple order; other platforms spell modifiers', () => {
    expect(caps('Mod+Shift+Z', 'mac')).toEqual({
      caps: [['⇧', '⌘', 'Z']],
      spoken: 'Shift Command Z',
    });
    expect(caps('Mod+Shift+Z', 'other')).toEqual({
      caps: [['Ctrl', 'Shift', 'Z']],
      spoken: 'Control Shift Z',
    });
    expect(caps('Mod+Alt+K', 'mac')).toEqual({
      caps: [['⌥', '⌘', 'K']],
      spoken: 'Option Command K',
    });
    expect(caps('Mod+/', 'other')).toEqual({ caps: [['Ctrl', '/']], spoken: 'Control Slash' });
  });
  test('sequences, arrows and punctuation have readable names', () => {
    expect(caps('G I', 'mac')).toEqual({ caps: [['G'], ['I']], spoken: 'G then I' });
    expect(caps('ArrowDown', 'other')).toEqual({ caps: [['↓']], spoken: 'Down arrow' });
    expect(caps('?', 'mac')).toEqual({ caps: [['?']], spoken: 'Question mark' });
    expect(caps('Escape', 'mac')).toEqual({ caps: [['Esc']], spoken: 'Escape' });
  });
  test('aria-keyshortcuts names each platform’s real keys and leaves out sequences', () => {
    expect(ariaKeyShortcuts(['Mod+Shift+Z'], 'mac')).toBe('Meta+Shift+Z');
    expect(ariaKeyShortcuts(['Mod+Y', 'Mod+Shift+Z'], 'other')).toBe('Control+Y Control+Shift+Z');
    expect(ariaKeyShortcuts(['Enter'], 'mac')).toBe('Enter');
    expect(ariaKeyShortcuts(['Shift+F10'], 'other')).toBe('Shift+F10');
    expect(ariaKeyShortcuts(['G I', 'X'], 'mac')).toBe('X');
    expect(ariaKeyShortcuts(['G I'], 'mac')).toBeUndefined();
    expect(ariaKeyShortcuts([], 'mac')).toBeUndefined();
  });
  test('platform detection prefers client hints and recognises Apple devices', () => {
    expect(detectPlatform({ platform: 'MacIntel' })).toBe('mac');
    expect(detectPlatform({ userAgentData: { platform: 'macOS' }, platform: 'Win32' })).toBe('mac');
    expect(detectPlatform({ platform: 'Win32' })).toBe('other');
    expect(
      detectPlatform({ platform: '', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' }),
    ).toBe('mac');
    expect(detectPlatform({ platform: 'Linux x86_64', userAgent: 'X11; Linux' })).toBe('other');
    expect(detectPlatform(undefined)).toBe('other');
  });
});

describe('permissions', () => {
  test('edit commands need a non-viewer role', () => {
    expect(commandAvailable(command('task.create'), 'member')).toBe(true);
    expect(commandAvailable(command('task.create'), 'viewer')).toBe(false);
    expect(commandAvailable(command('task.create'), undefined)).toBe(false);
    expect(commandAvailable(command('edit.undo'), 'viewer')).toBe(false);
    expect(commandAvailable(command('edit.redo'), 'owner')).toBe(true);
    expect(commandAvailable(command('palette.open'), 'viewer')).toBe(true);
    expect(commandAvailable(command('nav.inbox'), undefined)).toBe(true);
    // Selecting exists for bulk edits, which viewers cannot make.
    expect(commandAvailable(command('selection.toggle'), 'viewer')).toBe(false);
    expect(commandAvailable(command('list.extend-next'), 'viewer')).toBe(false);
    expect(commandAvailable(command('list.extend-previous'), 'member')).toBe(true);
    expect(commandAvailable(command('list.next'), 'viewer')).toBe(true);
  });
});

describe('escape', () => {
  const base = {
    composing: false,
    surfaceOpen: false,
    textEntry: false,
    selectionCount: 0,
    hasContext: false,
  };
  test('Escape resolves exactly one layer from the top', () => {
    const all = {
      composing: true,
      surfaceOpen: true,
      textEntry: true,
      selectionCount: 2,
      hasContext: true,
    };
    expect(escapeLayer(all)).toBe('ime');
    expect(escapeLayer({ ...all, composing: false })).toBe('surface');
    expect(escapeLayer({ ...all, composing: false, surfaceOpen: false })).toBe('edit');
    expect(escapeLayer({ ...base, selectionCount: 2, hasContext: true })).toBe('selection');
    expect(escapeLayer({ ...base, hasContext: true })).toBe('context');
    expect(escapeLayer(base)).toBe('none');
  });
});
