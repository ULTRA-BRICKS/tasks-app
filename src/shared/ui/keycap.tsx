import './keycap.css';
import { createContext, Fragment, useContext } from 'react';
import { workspaceCommands } from '../lib/command-catalog';
import {
  devicePlatform,
  effectiveBindings,
  keycapLabels,
  parseBinding,
  spokenBinding,
  type KeyBindingOverrides,
  type Platform,
} from '../lib/commands';

const KeyBindings = createContext<KeyBindingOverrides>({});
/** The user's per-device overrides, provided once by `app` so every keycap shows the real keys. */
export const KeyBindingsProvider = KeyBindings.Provider;
export const useKeyBindings = () => useContext(KeyBindings);

/** A command's effective bindings on this device, after the user's overrides. */
export function useCommandBindings(commandId: string): readonly string[] {
  const overrides = useKeyBindings();
  const command = workspaceCommands.find((c) => c.id === commandId);
  return command ? effectiveBindings(command, overrides, devicePlatform) : [];
}

/**
 * Visible keycaps for a canonical binding (`Mod+K`, `G I`). Glyphs are hidden from assistive
 * technology, which reads the spoken form instead ("Command K", "G then I"); `decorative`
 * drops the spoken form where the control already carries `aria-keyshortcuts`.
 */
export function Keycaps({
  binding,
  platform = devicePlatform,
  decorative = false,
}: {
  binding: string;
  platform?: Platform;
  decorative?: boolean;
}) {
  const parsed = parseBinding(binding);
  if (!parsed) return null;
  return (
    <span className="keycaps">
      <span className="keycaps-visual" aria-hidden="true">
        {keycapLabels(parsed, platform).map((step, index) => (
          <Fragment key={`${index}:${step.join('+')}`}>
            {index > 0 && <span className="keycaps-then">then</span>}
            {step.map((label) => (
              <kbd key={label} className="keycap">
                {label}
              </kbd>
            ))}
          </Fragment>
        ))}
      </span>
      {!decorative && <span className="sr-only">{spokenBinding(parsed, platform)}</span>}
    </span>
  );
}

/** Every effective binding of a command, separated by "or"; nothing when it has none. */
export function CommandKeycaps({
  command,
  decorative = false,
}: {
  command: string;
  decorative?: boolean;
}) {
  const bindings = useCommandBindings(command);
  if (!bindings.length) return null;
  return (
    <span className="command-keycaps" aria-hidden={decorative || undefined}>
      {bindings.map((binding, index) => (
        <Fragment key={binding}>
          {index > 0 && <span className="keycaps-or">or</span>}
          <Keycaps binding={binding} decorative={decorative} />
        </Fragment>
      ))}
    </span>
  );
}
