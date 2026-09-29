/**
 * Validation of per-device shortcut overrides read from storage. Storage is untrusted: the
 * catalog, the reserved list or the device platform may have changed since the value was saved.
 */
import {
  findConflicts,
  formatBinding,
  parseBinding,
  reservedReason,
  type CommandDefinition,
  type KeyBindingOverrides,
  type Platform,
} from '@/shared/lib/commands';

/**
 * Keeps canonical overrides of known, remappable commands. Malformed or reserved overrides are
 * dropped whole; while overrides conflict, the later command in catalog order loses its
 * override, so defaults (conflict-free by test) always survive.
 */
export function sanitizeKeyBindings(
  value: unknown,
  commands: readonly CommandDefinition[],
  platform: Platform,
): KeyBindingOverrides {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const kept: Record<string, string[]> = {};
  for (const command of commands) {
    const keys: unknown = Object.hasOwn(value, command.id)
      ? Reflect.get(value, command.id)
      : undefined;
    if (command.fixed || !Array.isArray(keys)) continue;
    const texts = keys.flatMap((key) => {
      const binding = typeof key === 'string' ? parseBinding(key) : null;
      return binding && !reservedReason(binding, platform) ? [formatBinding(binding)] : [];
    });
    // One malformed or reserved key drops the whole override; repeated keys collapse. A key
    // that prefixes another of the same command (`Y` beside `Y I`) could never fire.
    const unique = [...new Set(texts)];
    const shadowed = unique.some((a) => unique.some((b) => b.startsWith(`${a} `)));
    if (texts.length === keys.length && !shadowed) kept[command.id] = unique;
  }
  for (;;) {
    // A clash between defaults has no override to drop; keep looking past it.
    const loser = findConflicts(commands, kept, platform)
      .map((conflict) => conflict.commandIds.filter((id) => Object.hasOwn(kept, id)).at(-1))
      .find((id) => id !== undefined);
    if (!loser) return kept;
    delete kept[loser];
  }
}

/** Version 0 predates shortcuts; later versions are validated by `sanitizeKeyBindings` on merge. */
export function migratePreferences(persisted: unknown, version: number): Record<string, unknown> {
  const state: Record<string, unknown> =
    typeof persisted === 'object' && persisted !== null ? { ...persisted } : {};
  return version < 1 ? { ...state, keyBindings: {} } : state;
}
