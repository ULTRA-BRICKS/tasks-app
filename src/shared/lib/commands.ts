/**
 * Keyboard command registry model: canonical bindings, event matching, conflict and
 * reserved-key checks, platform display and Escape layering. It is pure so every FSD
 * layer can share it; handlers are attached where commands are dispatched.
 * Spec and decisions: docs/KEYBOARD-COMMANDS.md.
 */
import type { Role } from '@tickets/contracts';

export type Platform = 'mac' | 'other';
export type Combo = {
  readonly key: string;
  readonly mod: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
};
/** One or two steps; two-step sequences such as `G I` must finish within `sequenceTimeout`. */
export type Binding = readonly Combo[];
export type CommandDefinition = {
  readonly id: string;
  readonly title: string;
  readonly group: string;
  readonly keys: Readonly<Record<Platform, readonly string[]>>;
  /** Modifier bindings of these commands also fire inside inputs and editors. */
  readonly allowInTextEntry?: boolean;
  readonly requires?: 'edit';
  /** Fixed commands keep their defaults; users cannot remap them. */
  readonly fixed?: boolean;
};
/** Per-device overrides keyed by command id; an empty list removes every shortcut. */
export type KeyBindingOverrides = Readonly<Record<string, readonly string[]>>;
export type KeyEventLike = Pick<
  KeyboardEvent,
  'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'keyCode'
>;
export type BindingProblem =
  | { kind: 'unknown' | 'fixed' | 'invalid' }
  | { kind: 'reserved'; reason: string }
  | { kind: 'conflict'; commandId: string };
export type MatchState = { readonly prefix: string | null; readonly expires: number };
export type Keymap = {
  readonly single: ReadonlyMap<string, CommandDefinition>;
  readonly sequence: ReadonlyMap<string, CommandDefinition>;
  readonly prefixes: ReadonlySet<string>;
};
export type EscapeLayer = 'ime' | 'surface' | 'edit' | 'selection' | 'context' | 'none';

export const sequenceTimeout = 1000;
export const idleMatch: MatchState = { prefix: null, expires: 0 };

const namedKeys: Record<string, string> = {
  escape: 'Escape',
  esc: 'Escape',
  enter: 'Enter',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  ...Object.fromEntries(Array.from({ length: 12 }, (_, n) => [`f${n + 1}`, `F${n + 1}`])),
};
const modifierKeys: Record<string, true> = {
  Shift: true,
  Meta: true,
  Control: true,
  Alt: true,
  AltGraph: true,
  CapsLock: true,
  Fn: true,
  OS: true,
};

/** Letters are uppercase, printable ASCII stays as typed, and named keys use their DOM name. */
function normalizeKey(text: string): string | null {
  if (text === ' ') return 'Space';
  if (/^[\x21-\x7e]$/.test(text)) return text.toUpperCase();
  return namedKeys[text.toLowerCase()] ?? null;
}
const isPunctuation = (key: string) => key.length === 1 && !/^[A-Z0-9]$/.test(key);

function parseStep(text: string): Combo | null {
  const parts =
    text === '+'
      ? ['+']
      : text.endsWith('++')
        ? [...text.slice(0, -2).split('+'), '+']
        : text.split('+');
  const key = normalizeKey(parts.pop() ?? '');
  const modifiers = parts.map((part) => part.toLowerCase());
  if (!key || new Set(modifiers).size !== modifiers.length) return null;
  if (modifiers.some((m) => m !== 'mod' && m !== 'alt' && m !== 'shift')) return null;
  const shift = modifiers.includes('shift');
  // Shift is already part of punctuation (`?` is Shift+/), so `Shift+/` would be ambiguous.
  if (shift && isPunctuation(key)) return null;
  return { key, mod: modifiers.includes('mod'), alt: modifiers.includes('alt'), shift };
}

export function parseBinding(text: string): Binding | null {
  const steps = text.trim().split(/\s+/);
  if (!steps[0] || steps.length > 2) return null;
  const binding: Combo[] = [];
  for (const step of steps) {
    const combo = parseStep(step);
    if (!combo) return null;
    binding.push(combo);
  }
  return binding;
}

const formatStep = (combo: Combo) =>
  `${combo.mod ? 'Mod+' : ''}${combo.alt ? 'Alt+' : ''}${combo.shift ? 'Shift+' : ''}${combo.key}`;
export const formatBinding = (binding: Binding) => binding.map(formatStep).join(' ');
export function normalizeBinding(text: string): string | null {
  const binding = parseBinding(text);
  return binding ? formatBinding(binding) : null;
}

/**
 * Converts a key press to a combo, or null when the press belongs to text input or the OS:
 * IME composition, modifier-only presses, Control on Mac, the Windows key and AltGr.
 * Option symbols, dead keys and non-Latin letters or digits fall back to the physical key.
 */
export function eventToCombo(event: KeyEventLike, platform: Platform): Combo | null {
  if (event.isComposing || event.key === 'Process' || event.keyCode === 229) return null;
  if (modifierKeys[event.key]) return null;
  const mod = platform === 'mac' ? event.metaKey : event.ctrlKey;
  if (platform === 'mac' ? event.ctrlKey : event.metaKey) return null;
  if (platform === 'other' && event.ctrlKey && event.altKey) return null;
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
  const digit = /^Digit(\d)$/.exec(event.code)?.[1];
  let key = normalizeKey(event.key);
  if (letter && (key === null || event.altKey)) key = letter;
  const physicalDigit = Boolean(digit && (key === null || mod || event.altKey));
  if (digit && physicalDigit) key = digit;
  if (!key) return null;
  const shift =
    !isPunctuation(key) && (key.length > 1 || /^[A-Z]$/.test(key) || physicalDigit)
      ? event.shiftKey
      : false;
  return { key, mod, alt: event.altKey, shift };
}

export function detectPlatform(
  nav: { platform?: string; userAgent?: string; userAgentData?: { platform?: string } } | undefined,
): Platform {
  const hint = nav?.userAgentData?.platform || nav?.platform || nav?.userAgent || '';
  return /mac|iphone|ipad|ipod/i.test(hint) ? 'mac' : 'other';
}
/** This device's platform, read once; `globalThis` keeps non-browser imports from throwing. */
export const devicePlatform = detectPlatform(globalThis.navigator);

export function effectiveBindings(
  command: CommandDefinition,
  overrides: KeyBindingOverrides,
  platform: Platform,
): readonly string[] {
  return !command.fixed && Object.hasOwn(overrides, command.id)
    ? (overrides[command.id] ?? [])
    : command.keys[platform];
}

export function createKeymap(
  commands: readonly CommandDefinition[],
  overrides: KeyBindingOverrides,
  platform: Platform,
): Keymap {
  const single = new Map<string, CommandDefinition>(),
    sequence = new Map<string, CommandDefinition>(),
    prefixes = new Set<string>();
  for (const command of commands)
    for (const text of effectiveBindings(command, overrides, platform)) {
      const steps = parseBinding(text)?.map(formatStep);
      if (!steps) continue;
      const target = steps.length === 1 ? single : sequence;
      if (!target.has(steps.join(' '))) target.set(steps.join(' '), command);
      if (steps.length > 1 && steps[0]) prefixes.add(steps[0]);
    }
  return { single, sequence, prefixes };
}

/**
 * Resolves one key press. Inside text entry only modifier bindings of commands that allow it
 * fire, so typing and native text undo stay untouched. A pending sequence prefix that meets an
 * unknown key falls through to that key's own binding.
 */
export function matchShortcut(
  keymap: Keymap,
  state: MatchState,
  combo: Combo,
  context: { textEntry: boolean },
  now: number,
): { state: MatchState; commandId?: string; pending: boolean } {
  const step = formatStep(combo);
  if (context.textEntry) {
    const command = keymap.single.get(step);
    const allowed = command?.allowInTextEntry && (combo.mod || combo.alt);
    return { state: idleMatch, commandId: allowed ? command.id : undefined, pending: false };
  }
  if (state.prefix && now < state.expires) {
    const command = keymap.sequence.get(`${state.prefix} ${step}`);
    if (command) return { state: idleMatch, commandId: command.id, pending: false };
  }
  if (keymap.prefixes.has(step))
    return { state: { prefix: step, expires: now + sequenceTimeout }, pending: true };
  return { state: idleMatch, commandId: keymap.single.get(step)?.id, pending: false };
}

const sharedReserved: Record<string, string> = {
  'Mod+W': 'closes the browser tab',
  'Mod+Shift+W': 'closes the browser window',
  'Mod+T': 'opens a new browser tab',
  'Mod+Shift+T': 'reopens the last closed tab',
  'Mod+N': 'opens a new browser window',
  'Mod+Shift+N': 'opens a private browser window',
  'Mod+R': 'reloads the page',
  'Mod+Shift+R': 'reloads the page without the cache',
  'Mod+L': 'focuses the address bar',
  'Mod+D': 'bookmarks the page',
  'Mod+P': 'prints the page',
  'Mod+F': 'searches the page',
  'Mod+G': 'finds the next match',
  'Mod+C': 'copies the selection',
  'Mod+X': 'cuts the selection',
  'Mod+V': 'pastes',
  'Mod+A': 'selects all text',
  'Mod+=': 'zooms in',
  'Mod++': 'zooms in',
  'Mod+-': 'zooms out',
  'Mod+0': 'resets the zoom',
  'Mod+Tab': 'switches browser tabs',
  'Mod+Shift+Tab': 'switches browser tabs',
  'Mod+Shift+I': 'opens developer tools',
  'Mod+Alt+I': 'opens developer tools',
  'Mod+Shift+Delete': 'clears browsing data',
  Tab: 'moves keyboard focus',
  'Shift+Tab': 'moves keyboard focus',
  Enter: 'activates the focused control',
  Space: 'activates the focused control',
  F5: 'reloads the page',
  F11: 'toggles full screen',
  F12: 'opens developer tools',
  ...Object.fromEntries(
    Array.from({ length: 9 }, (_, n) => [`Mod+${n + 1}`, 'switches browser tabs']),
  ),
};
const reservedByPlatform: Record<Platform, Record<string, string>> = {
  mac: {
    ...sharedReserved,
    'Mod+Q': 'quits the browser',
    'Mod+H': 'hides the browser',
    'Mod+Alt+H': 'hides other apps',
    'Mod+M': 'minimizes the window',
    'Mod+Space': 'opens Spotlight',
    'Mod+,': 'opens browser settings',
    'Mod+Y': 'opens browser history',
    'Mod+[': 'goes back',
    'Mod+]': 'goes forward',
    'Mod+{': 'switches browser tabs',
    'Mod+}': 'switches browser tabs',
    'Mod+ArrowLeft': 'goes back',
    'Mod+ArrowRight': 'goes forward',
    'Mod+Alt+Escape': 'force-quits apps',
  },
  other: {
    ...sharedReserved,
    'Alt+F4': 'closes the window',
    'Alt+Tab': 'switches windows',
    'Alt+Space': 'opens the window menu',
    'Alt+D': 'focuses the address bar',
    'Alt+Home': 'opens the home page',
    'Alt+ArrowLeft': 'goes back',
    'Alt+ArrowRight': 'goes forward',
    'Mod+H': 'opens browser history',
    'Mod+J': 'opens downloads',
    'Mod+PageUp': 'switches browser tabs',
    'Mod+PageDown': 'switches browser tabs',
  },
};

/** What the browser or OS does with this binding, or null when the page may own it. */
export function reservedReason(binding: Binding, platform: Platform): string | null {
  for (const combo of binding) {
    const reason = reservedByPlatform[platform][formatStep(combo)];
    if (reason) return reason;
  }
  return null;
}

/** Equal bindings and prefixes (`G` against `G I`) cannot both be dispatched. */
function overlaps(a: readonly string[], b: readonly string[]): boolean {
  const length = Math.min(a.length, b.length);
  return a.slice(0, length).join(' ') === b.slice(0, length).join(' ');
}
function bindingSteps(
  commands: readonly CommandDefinition[],
  overrides: KeyBindingOverrides,
  platform: Platform,
) {
  return commands.flatMap((command) =>
    effectiveBindings(command, overrides, platform).flatMap((text) => {
      const binding = parseBinding(text);
      return binding ? [{ command, steps: binding.map(formatStep) }] : [];
    }),
  );
}

export function checkBinding(
  commands: readonly CommandDefinition[],
  overrides: KeyBindingOverrides,
  platform: Platform,
  commandId: string,
  text: string,
): BindingProblem | null {
  const command = commands.find((c) => c.id === commandId);
  if (!command) return { kind: 'unknown' };
  if (command.fixed) return { kind: 'fixed' };
  const binding = parseBinding(text);
  if (!binding) return { kind: 'invalid' };
  const reason = reservedReason(binding, platform);
  if (reason) return { kind: 'reserved', reason };
  const steps = binding.map(formatStep);
  const clash = bindingSteps(commands, overrides, platform).find(
    (entry) => entry.command.id !== commandId && overlaps(steps, entry.steps),
  );
  return clash ? { kind: 'conflict', commandId: clash.command.id } : null;
}

/** Every binding shared by several commands, keyed by the shorter binding, in catalog order. */
export function findConflicts(
  commands: readonly CommandDefinition[],
  overrides: KeyBindingOverrides,
  platform: Platform,
): Array<{ binding: string; commandIds: string[] }> {
  const entries = bindingSteps(commands, overrides, platform);
  const groups = new Map<string, Set<string>>();
  entries.forEach((a, index) => {
    for (const b of entries.slice(index + 1)) {
      if (a.command.id === b.command.id || !overlaps(a.steps, b.steps)) continue;
      const key = (a.steps.length <= b.steps.length ? a : b).steps.join(' ');
      const group = groups.get(key) ?? new Set<string>();
      groups.set(key, group.add(a.command.id).add(b.command.id));
    }
  });
  return [...groups].map(([binding, ids]) => ({
    binding,
    commandIds: commands.map((c) => c.id).filter((id) => ids.has(id)),
  }));
}

type Modifier = 'mod' | 'alt' | 'shift';
/** Each platform's conventional modifier order: Apple ⌥ ⇧ ⌘, others Ctrl Alt Shift. */
const modifierOrder: Record<Platform, readonly Modifier[]> = {
  mac: ['alt', 'shift', 'mod'],
  other: ['mod', 'alt', 'shift'],
};
const capModifiers: Record<Platform, Record<Modifier, string>> = {
  mac: { alt: '⌥', shift: '⇧', mod: '⌘' },
  other: { mod: 'Ctrl', alt: 'Alt', shift: 'Shift' },
};
const spokenModifiers: Record<Platform, Record<Modifier, string>> = {
  mac: { alt: 'Option', shift: 'Shift', mod: 'Command' },
  other: { mod: 'Control', alt: 'Alt', shift: 'Shift' },
};
const capKeys: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Delete: 'Del',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
};
const spokenKeys: Record<string, string> = {
  ArrowUp: 'Up arrow',
  ArrowDown: 'Down arrow',
  ArrowLeft: 'Left arrow',
  ArrowRight: 'Right arrow',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  '?': 'Question mark',
  '/': 'Slash',
  '\\': 'Backslash',
  ',': 'Comma',
  '.': 'Period',
  ';': 'Semicolon',
  "'": 'Quote',
  '`': 'Backtick',
  '[': 'Left bracket',
  ']': 'Right bracket',
  '-': 'Minus',
  '=': 'Equals',
  '+': 'Plus',
};
function nameSteps(
  binding: Binding,
  platform: Platform,
  modifiers: Record<Modifier, string>,
  keys: Record<string, string>,
): string[][] {
  return binding.map((combo) => [
    ...modifierOrder[platform].filter((m) => combo[m]).map((m) => modifiers[m]),
    keys[combo.key] ?? combo.key,
  ]);
}
export const keycapLabels = (binding: Binding, platform: Platform) =>
  nameSteps(binding, platform, capModifiers[platform], capKeys);
/** The binding as assistive technology should read it, for example "Command K" or "G then I". */
export const spokenBinding = (binding: Binding, platform: Platform) =>
  nameSteps(binding, platform, spokenModifiers[platform], spokenKeys)
    .map((step) => step.join(' '))
    .join(' then ');

export function commandAvailable(command: CommandDefinition, role: Role | undefined): boolean {
  return command.requires !== 'edit' || (role !== undefined && role !== 'viewer');
}

/**
 * Escape handles one layer per press. IME composition and open surfaces own their own Escape;
 * an active text edit cancels itself and keeps its draft; only then does the selection clear,
 * and finally the page context (a task page returns to its list).
 */
export function escapeLayer(state: {
  composing: boolean;
  surfaceOpen: boolean;
  textEntry: boolean;
  selectionCount: number;
  hasContext: boolean;
}): EscapeLayer {
  if (state.composing) return 'ime';
  if (state.surfaceOpen) return 'surface';
  if (state.textEntry) return 'edit';
  if (state.selectionCount > 0) return 'selection';
  return state.hasContext ? 'context' : 'none';
}
