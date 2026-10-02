import './style.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMe } from '@/entities/workspace';
import { workspaceCommands } from '@/shared/lib/command-catalog';
import {
  commandAvailable,
  createKeymap,
  devicePlatform,
  escapeLayer,
  eventToCombo,
  idleMatch,
  matchShortcut,
} from '@/shared/lib/commands';
import { hasSelectedText } from '@/shared/lib/press-hold';
import { keyTarget, openSurface } from '@/shared/lib/shortcuts';
import { CommandKeycaps, Modal, useCommandBindings, useKeyBindings } from '@/shared/ui';
import { pageHandler, pageSelection, type CommandHandlers } from './model';

const commandsById = new Map(workspaceCommands.map((command) => [command.id, command]));
const destinations: Record<string, string> = {
  'nav.tasks': '/tasks',
  'nav.my-tasks': '/my-tasks',
  'nav.projects': '/projects',
  'nav.cycles': '/cycles',
  'nav.inbox': '/inbox',
  'nav.settings': '/settings',
};
function returnPath(state: unknown) {
  return typeof state === 'object' &&
    state !== null &&
    'from' in state &&
    typeof state.from === 'string'
    ? state.from
    : '/tasks';
}

/**
 * The workspace keyboard: one capture-phase listener dispatches the registry's bindings (with
 * this device's overrides from `KeyBindingsProvider`) to handlers attached here, by `app`
 * (`appHandlers`) or by the mounted page (`usePageCommands`). `run` executes a command the same
 * way for the command menu. Spec: docs/KEYBOARD-COMMANDS.md.
 */
export function useWorkspaceCommands(appHandlers: CommandHandlers) {
  const { data: me } = useMe(),
    navigate = useNavigate(),
    location = useLocation(),
    overrides = useKeyBindings();
  const [helpOpen, setHelpOpen] = useState(false);
  const keymap = useMemo(
    () => createKeymap(workspaceCommands, overrides, devicePlatform),
    [overrides],
  );
  const handlers: CommandHandlers = {
    'help.open': () => setHelpOpen(true),
    'task.create': () =>
      void navigate('/tasks/new', { state: { from: location.pathname + location.search } }),
    ...Object.fromEntries(
      Object.entries(destinations).map(([id, path]) => [id, () => void navigate(path)]),
    ),
    ...appHandlers,
  };
  // A task page (or a new task) returns to the list it was opened from.
  const leave = location.pathname.startsWith('/tasks/')
    ? () => void navigate(returnPath(location.state))
    : null;
  const run = (commandId: string) => {
    const command = commandsById.get(commandId);
    if (command && commandAvailable(command, me?.role))
      (pageHandler(commandId) ?? handlers[commandId])?.();
  };
  const latest = useRef({ keymap, role: me?.role, handlers, leave });
  useEffect(() => {
    latest.current = { keymap, role: me?.role, handlers, leave };
  });
  const match = useRef(idleMatch);
  // A pending `G` never carries over to another page.
  useEffect(() => {
    match.current = idleMatch;
  }, [location.key]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // The shortcut recorder in Settings owns every key while it records.
      if (event.target instanceof Element && event.target.closest('[data-shortcut-recording]'))
        return;
      const combo = eventToCombo(event, devicePlatform);
      if (!combo) return;
      const owner = keyTarget(event.target),
        surface = openSurface(),
        escape = combo.key === 'Escape' && !combo.mod && !combo.alt && !combo.shift,
        unmodified = !combo.mod && !combo.alt;
      // Open surfaces own every key but leave Escape to their own handler. A focused widget
      // keeps its plain keys for type-ahead and Escape for itself; a text selection keeps
      // unshifted keys for copying, while Shift+J/K still extend the range.
      if (
        (surface && !escape) ||
        (unmodified && owner === 'widget') ||
        (unmodified && !combo.shift && !escape && hasSelectedText())
      ) {
        match.current = idleMatch;
        return;
      }
      const { keymap, role, handlers, leave } = latest.current;
      const result = matchShortcut(
        keymap,
        match.current,
        combo,
        { textEntry: owner === 'text' },
        performance.now(),
      );
      match.current = result.state;
      const command = result.commandId ? commandsById.get(result.commandId) : undefined;
      if (!command || (event.repeat && !command.repeat) || !commandAvailable(command, role)) return;
      if (command.id === 'layer.dismiss') {
        const selection = pageSelection();
        const layer = escapeLayer({
          composing: false,
          surfaceOpen: surface !== null,
          textEntry: owner === 'text',
          selectionCount: selection?.count ?? 0,
          hasContext: leave !== null,
        });
        const dismiss =
          layer === 'selection' ? selection?.clear : layer === 'context' ? leave : null;
        if (!dismiss) return;
        // Marked handled but not stopped, as the listener before the registry did: this layer
        // only applies when no surface or field owns Escape, so nothing below needs shielding.
        event.preventDefault();
        dismiss();
        return;
      }
      const handler = pageHandler(command.id) ?? handlers[command.id];
      if (!handler) return;
      event.preventDefault();
      event.stopPropagation();
      handler();
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, []);
  return { run, helpOpen, setHelpOpen };
}

function HelpRow({ commandId, title }: { commandId: string; title: string }) {
  const bindings = useCommandBindings(commandId);
  return (
    <li className="shortcut-sheet-row">
      <span>{title}</span>
      {bindings.length ? (
        <CommandKeycaps command={commandId} />
      ) : (
        <span className="shortcut-sheet-none">No shortcut</span>
      )}
    </li>
  );
}

/** The ⌘/ sheet: every registry command with this device's keycaps, grouped as in Settings. */
export function ShortcutHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const groups = [...new Set(workspaceCommands.map((command) => command.group))];
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      className="shortcut-sheet"
    >
      <div className="shortcut-sheet-groups">
        {groups.map((group) => {
          const heading = `shortcut-sheet-${group.toLowerCase().replace(/\s+/g, '-')}`;
          return (
            <section key={group} aria-labelledby={heading}>
              <h3 id={heading}>{group}</h3>
              <ul>
                {workspaceCommands
                  .filter((command) => command.group === group)
                  .map((command) => (
                    <HelpRow key={command.id} commandId={command.id} title={command.title} />
                  ))}
              </ul>
            </section>
          );
        })}
      </div>
      <Link
        className="shortcut-sheet-customize"
        to="/settings?tab=keyboard"
        onClick={() => onOpenChange(false)}
      >
        Customize shortcuts
      </Link>
    </Modal>
  );
}
