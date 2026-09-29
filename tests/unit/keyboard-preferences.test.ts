import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { workspaceCommands } from '../../src/shared/lib/command-catalog';
import {
  migratePreferences,
  sanitizeKeyBindings,
} from '../../src/features/preferences/key-bindings';

describe('key binding sanitation', () => {
  test('malformed stored values become no overrides', () => {
    for (const value of [undefined, null, 'X', 42, ['X']])
      expect(sanitizeKeyBindings(value, workspaceCommands, 'mac')).toEqual({});
  });
  test('valid overrides are kept in canonical form; removals survive', () => {
    expect(
      sanitizeKeyBindings(
        { 'nav.inbox': ['shift+i'], 'task.create': [] },
        workspaceCommands,
        'mac',
      ),
    ).toEqual({ 'nav.inbox': ['Shift+I'], 'task.create': [] });
  });
  test('duplicate keys within one override collapse to one', () => {
    expect(
      sanitizeKeyBindings({ 'nav.inbox': ['Shift+I', 'shift+i'] }, workspaceCommands, 'mac'),
    ).toEqual({ 'nav.inbox': ['Shift+I'] });
    // `Y` would never fire next to its own `Y I`: the prefix waits for a second key.
    expect(sanitizeKeyBindings({ 'nav.tasks': ['Y', 'Y I'] }, workspaceCommands, 'mac')).toEqual(
      {},
    );
    expect(sanitizeKeyBindings({ 'nav.tasks': ['Y', 'Y'] }, workspaceCommands, 'mac')).toEqual({
      'nav.tasks': ['Y'],
    });
  });
  test('unknown, fixed, malformed and reserved overrides are dropped', () => {
    expect(
      sanitizeKeyBindings(
        {
          'removed.command': ['Shift+R'],
          'layer.dismiss': ['Shift+D'],
          'nav.inbox': 'Shift+I',
          'nav.settings': ['Shift+/'],
          'nav.projects': ['Mod+W'],
          'nav.cycles': [42],
        },
        workspaceCommands,
        'other',
      ),
    ).toEqual({});
  });
  test('conflicts drop the later override, but a freed key may be reused', () => {
    expect(sanitizeKeyBindings({ 'nav.inbox': ['X'] }, workspaceCommands, 'mac')).toEqual({});
    expect(
      sanitizeKeyBindings(
        { 'nav.inbox': ['Shift+I'], 'nav.settings': ['Shift+I'] },
        workspaceCommands,
        'mac',
      ),
    ).toEqual({ 'nav.inbox': ['Shift+I'] });
    expect(
      sanitizeKeyBindings(
        { 'nav.inbox': ['X'], 'selection.toggle': ['Shift+X'] },
        workspaceCommands,
        'mac',
      ),
    ).toEqual({ 'nav.inbox': ['X'], 'selection.toggle': ['Shift+X'] });
  });
  test('a clash between defaults does not stop later override conflicts from resolving', () => {
    const commands = [
      { id: 'a', title: 'A', group: 'G', keys: { mac: ['X'], other: ['X'] } },
      { id: 'b', title: 'B', group: 'G', keys: { mac: ['X'], other: ['X'] } },
      { id: 'c', title: 'C', group: 'G', keys: { mac: ['Y'], other: ['Y'] } },
      { id: 'd', title: 'D', group: 'G', keys: { mac: ['Z'], other: ['Z'] } },
    ];
    expect(sanitizeKeyBindings({ d: ['Y'] }, commands, 'mac')).toEqual({});
  });
  test('reserved keys depend on the device platform', () => {
    expect(sanitizeKeyBindings({ 'nav.inbox': ['Mod+Q'] }, workspaceCommands, 'other')).toEqual({
      'nav.inbox': ['Mod+Q'],
    });
    expect(sanitizeKeyBindings({ 'nav.inbox': ['Mod+Q'] }, workspaceCommands, 'mac')).toEqual({});
  });
  test('version 0 preferences migrate without losing appearance settings', () => {
    expect(migratePreferences({ view: 'board', theme: 'light', density: 'compact' }, 0)).toEqual({
      view: 'board',
      theme: 'light',
      density: 'compact',
      keyBindings: {},
    });
    expect(migratePreferences(null, 0)).toEqual({ keyBindings: {} });
  });
});

describe('persisted preferences store', () => {
  const values: Record<string, string> = {};
  beforeAll(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (name: string) => values[name] ?? null,
        setItem: (name: string, value: string) => {
          values[name] = value;
        },
        removeItem: (name: string) => {
          delete values[name];
        },
      },
    });
    values['tickets-ui'] = JSON.stringify({
      state: { view: 'board', theme: 'light', density: 'auto' },
      version: 0,
    });
  });
  afterAll(() => {
    Reflect.deleteProperty(globalThis, 'localStorage');
  });
  test('a version 0 blob hydrates, and bindings round-trip through storage', async () => {
    // Zustand binds localStorage when the store module loads, so it must load after the fake exists.
    const { usePreferences } = await import('../../src/features/preferences/model');
    await usePreferences.persist.rehydrate();
    expect(usePreferences.getState()).toMatchObject({
      view: 'board',
      theme: 'light',
      keyBindings: {},
    });

    usePreferences.getState().setKeyBinding('nav.inbox', ['shift+i']);
    const saved = JSON.parse(values['tickets-ui'] ?? '{}');
    expect(saved.version).toBe(1);
    expect(saved.state).toMatchObject({ view: 'board', keyBindings: { 'nav.inbox': ['Shift+I'] } });

    usePreferences.getState().setKeyBinding('nav.settings', ['Shift+I']);
    expect(usePreferences.getState().keyBindings).toEqual({ 'nav.inbox': ['Shift+I'] });
    // A conflicting new binding is refused even when its command comes first in the catalog.
    usePreferences.getState().setKeyBinding('palette.open', ['Shift+I']);
    expect(usePreferences.getState().keyBindings).toEqual({ 'nav.inbox': ['Shift+I'] });

    usePreferences.getState().resetKeyBinding('nav.inbox');
    expect(JSON.parse(values['tickets-ui'] ?? '{}').state.keyBindings).toEqual({});

    values['tickets-ui'] = JSON.stringify({
      state: { view: 'list', keyBindings: { 'nav.inbox': ['Mod+W'], 'task.create': ['Shift+N'] } },
      version: 1,
    });
    await usePreferences.persist.rehydrate();
    expect(usePreferences.getState().keyBindings).toEqual({ 'task.create': ['Shift+N'] });
    usePreferences.getState().resetKeyBindings();
    expect(usePreferences.getState().keyBindings).toEqual({});

    values['tickets-ui'] = JSON.stringify({
      state: { view: 'grid', theme: 'purple', density: 3, setTheme: 'x', sidebarOpen: true },
      version: 1,
    });
    await usePreferences.persist.rehydrate();
    const restored = usePreferences.getState();
    expect(restored).toMatchObject({ view: 'list', theme: 'light', density: 'auto' });
    expect(restored.sidebarOpen).toBe(false);
    restored.setTheme('dark');
    expect(usePreferences.getState().theme).toBe('dark');
  });
});
