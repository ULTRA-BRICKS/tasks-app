import { commands, defaultBindings } from './commands';
export type Bindings = Record<string, string[]>;
const aliases: Record<string, string> = {
  esc: 'Escape',
  escape: 'Escape',
  enter: 'Enter',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  space: 'Space',
};
export function normalizeShortcut(input: string): string | null {
  if (input.length > 80) return null;
  const strokes = input.trim().split(/\s+/);
  if (!input.trim() || strokes.length > 2) return null;
  const result = [];
  for (const stroke of strokes) {
    const parts = stroke.split('+'),
      raw = parts.pop()!.toLowerCase();
    const mods: string[] = parts.map((m) =>
      /^(mod|cmd|ctrl|meta)$/i.test(m)
        ? 'Mod'
        : /^shift$/i.test(m)
          ? 'Shift'
          : /^alt$/i.test(m)
            ? 'Alt'
            : '',
    );
    if (mods.includes('') || new Set(mods).size !== mods.length) return null;
    const key = aliases[raw] ?? raw;
    if (!/^[a-z0-9/.,;[\]-]$/.test(key) && !Object.values(aliases).includes(key)) return null;
    result.push([...['Mod', 'Alt', 'Shift'].filter((m) => mods.includes(m)), key].join('+'));
  }
  return result.join(' ');
}
export function shortcutStroke(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
): string | null {
  if (event.ctrlKey && event.altKey && !event.metaKey) return null; // AltGr text input.
  const punctuation: Record<string, string> = {
    Slash: '/',
    Period: '.',
    Comma: ',',
    BracketLeft: '[',
    BracketRight: ']',
    Space: 'Space',
  };
  const key = /^Key[A-Z]$/.test(event.code)
    ? event.code.slice(3).toLowerCase()
    : (punctuation[event.code] ?? (event.key === '?' ? '/' : event.key));
  return normalizeShortcut(
    [
      event.metaKey || event.ctrlKey ? 'Mod' : '',
      event.altKey ? 'Alt' : '',
      event.shiftKey ? 'Shift' : '',
      key,
    ]
      .filter(Boolean)
      .join('+'),
  );
}
const reserved = new Set([
  'Escape',
  'Enter',
  'Space',
  'Mod+l',
  'Mod+t',
  'Mod+w',
  'Mod+n',
  'Mod+r',
  'Mod+q',
  'Mod+Shift+t',
  'Mod+Shift+n',
  'Mod+Shift+w',
  'Alt+ArrowLeft',
  'Alt+ArrowRight',
]);
const conflict = (a: string, b: string) =>
  a === b || a.startsWith(b + ' ') || b.startsWith(a + ' ');
export function bindingError(id: string, proposed: string[], bindings: Bindings): string | null {
  const command = commands.find((c) => c.id === id);
  if (!command || proposed.length > 3) return 'Use at most three shortcuts for a known command.';
  if (proposed.some((k) => normalizeShortcut(k) !== k || k.split(' ').some((s) => reserved.has(s))))
    return 'That shortcut is reserved or invalid.';
  if (proposed.some((key, i) => proposed.slice(i + 1).some((other) => conflict(key, other))))
    return 'These shortcuts conflict with each other.';
  for (const other of commands) {
    if (other.id === id || (command.scope && other.scope && command.scope !== other.scope))
      continue;
    if (
      proposed.some((key) =>
        (bindings[other.id] ?? other.keys).some((existing) => conflict(key, existing)),
      )
    )
      return 'Already used by ' + other.label + '.';
  }
  return null;
}
export function readBindings(raw: string | null): Bindings {
  const bindings = defaultBindings();
  try {
    const parsed: unknown = JSON.parse(raw ?? 'null');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return bindings;
    for (const command of commands) {
      const value: unknown = (parsed as Record<string, unknown>)[command.id];
      if (
        Array.isArray(value) &&
        value.every((x) => typeof x === 'string') &&
        !bindingError(command.id, value, bindings)
      )
        bindings[command.id] = value;
    }
  } catch {
    /* Retain usable defaults when storage is malformed. */
  }
  return bindings;
}
export function formatKey(key: string, mac: boolean): string {
  return (
    (
      {
        Mod: mac ? '⌘' : 'Ctrl',
        Alt: mac ? '⌥' : 'Alt',
        Shift: '⇧',
        ArrowUp: '↑',
        ArrowDown: '↓',
        Escape: 'Esc',
      } as Record<string, string>
    )[key] ?? key.toUpperCase()
  );
}
