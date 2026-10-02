import './style.css';
import { Fragment, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { workspaceCommands } from '@/shared/lib/command-catalog';
import {
  checkBinding,
  devicePlatform as platform,
  effectiveBindings,
  eventToCombo,
  formatBinding,
  spokenBinding,
  type BindingProblem,
  type Combo,
  type CommandDefinition,
} from '@/shared/lib/commands';
import { Button, Keycaps } from '@/shared/ui';
import { usePreferences } from './model';

function problemText(problem: BindingProblem, combo: Combo): string {
  const spoken = spokenBinding([combo], platform);
  if (problem.kind === 'reserved') return `${spoken} is reserved: it ${problem.reason}.`;
  if (problem.kind === 'conflict') {
    const owner = workspaceCommands.find((c) => c.id === problem.commandId);
    return `${spoken} is already used by “${owner?.title ?? problem.commandId}”.`;
  }
  return `${spoken} can’t be used as a shortcut.`;
}

/**
 * Per-device shortcut remapping. Recording captures one key combination; reserved and
 * conflicting combinations are refused with an announced reason. Escape (with any modifier)
 * cancels only the recording, Tab leaves it, and IME or modifier-only presses are ignored.
 */
export function KeyboardShortcutSettings() {
  const keyBindings = usePreferences((s) => s.keyBindings),
    setKeyBinding = usePreferences((s) => s.setKeyBinding),
    resetKeyBinding = usePreferences((s) => s.resetKeyBinding),
    resetKeyBindings = usePreferences((s) => s.resetKeyBindings);
  const [recording, setRecording] = useState<string | null>(null),
    [error, setError] = useState<{ commandId: string; text: string } | null>(null),
    [status, setStatus] = useState('');
  const groups = [...new Set(workspaceCommands.map((c) => c.group))];
  // Reset and Remove can leave the row; focus returns to the row's Change button.
  const changeButtons = useRef(new Map<string, HTMLButtonElement>());
  const settle = (command: CommandDefinition, message: string) => {
    setStatus(`${command.title}: ${message}`);
    changeButtons.current.get(command.id)?.focus();
  };
  const cancel = (command: CommandDefinition) => {
    setRecording(null);
    setError(null);
    setStatus(`${command.title}: shortcut unchanged.`);
  };

  const start = (event: MouseEvent<HTMLButtonElement>, command: CommandDefinition) => {
    // Safari does not focus buttons on click; keys must reach the recorder.
    event.currentTarget.focus();
    setRecording(command.id);
    setError(null);
    setStatus('');
  };
  const record = (event: KeyboardEvent<HTMLButtonElement>, command: CommandDefinition) => {
    if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) return;
    // A held modifier must not turn a cancel into a Shift+Escape binding.
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
      // The recording is the topmost layer: Escape must not also close an enclosing dialog.
      event.preventDefault();
      event.stopPropagation();
      cancel(command);
      return;
    }
    const combo = eventToCombo(event.nativeEvent, platform);
    if (!combo) return;
    event.preventDefault();
    event.stopPropagation();
    const text = formatBinding([combo]);
    const problem = checkBinding(workspaceCommands, keyBindings, platform, command.id, text);
    if (problem) {
      setError({ commandId: command.id, text: problemText(problem, combo) });
      return;
    }
    setKeyBinding(command.id, [text]);
    setRecording(null);
    setError(null);
    setStatus(`${command.title}: ${spokenBinding([combo], platform)}.`);
  };

  return (
    <div className="shortcut-settings">
      <p id="shortcut-recorder-help" className="settings-description">
        Shortcuts are saved on this device. Choose Change and press the new keys; Escape cancels.
      </p>
      {/* The live region announces; the same text is shown under the row being edited. */}
      <p className="sr-only" role="alert">
        {error?.text}
      </p>
      <output className="shortcut-status">{status}</output>
      {groups.map((group) => {
        const headingId = `shortcut-group-${group.toLowerCase().replace(/\s+/g, '-')}`;
        return (
          <section key={group} className="shortcut-group" aria-labelledby={headingId}>
            <h3 id={headingId}>{group}</h3>
            <ul className="shortcut-list">
              {workspaceCommands
                .filter((command) => command.group === group)
                .map((command) => {
                  const bindings = effectiveBindings(command, keyBindings, platform),
                    active = recording === command.id,
                    customized = Object.hasOwn(keyBindings, command.id);
                  return (
                    <li key={command.id} className="shortcut-row">
                      <span className="shortcut-title">{command.title}</span>
                      <span className="shortcut-keys">
                        {bindings.length ? (
                          bindings.map((binding, index) => (
                            <Fragment key={binding}>
                              {index > 0 && <span className="shortcut-muted">or</span>}
                              <Keycaps binding={binding} platform={platform} />
                            </Fragment>
                          ))
                        ) : (
                          <span className="shortcut-muted">No shortcut</span>
                        )}
                      </span>
                      <span className="shortcut-actions">
                        {command.fixed ? (
                          <span className="shortcut-muted">Fixed</span>
                        ) : (
                          // Stable slots: Change and Remove never move, Reset is appended last,
                          // so nothing new lands under the pointer after a click.
                          <>
                            <Button
                              ref={(node) => {
                                if (node) changeButtons.current.set(command.id, node);
                                return () => {
                                  changeButtons.current.delete(command.id);
                                };
                              }}
                              size="sm"
                              variant="ghost"
                              data-shortcut-recording={active ? '' : undefined}
                              aria-describedby={active ? 'shortcut-recorder-help' : undefined}
                              onClick={(event) => start(event, command)}
                              onKeyDown={active ? (event) => record(event, command) : undefined}
                              onBlur={active ? () => cancel(command) : undefined}
                            >
                              {active ? 'Press keys' : 'Change'}
                              <span className="sr-only">
                                {active ? ' for ' : ' shortcut for '}
                                {command.title}
                              </span>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!bindings.length}
                              onClick={() => {
                                setKeyBinding(command.id, []);
                                settle(command, 'shortcut removed.');
                              }}
                            >
                              Remove<span className="sr-only"> shortcut for {command.title}</span>
                            </Button>
                            {customized && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  resetKeyBinding(command.id);
                                  settle(command, 'default shortcut restored.');
                                }}
                              >
                                Reset<span className="sr-only"> shortcut for {command.title}</span>
                              </Button>
                            )}
                          </>
                        )}
                      </span>
                      {error?.commandId === command.id && (
                        <p className="shortcut-error" aria-hidden="true">
                          {error.text}
                        </p>
                      )}
                    </li>
                  );
                })}
            </ul>
          </section>
        );
      })}
      <Button
        className="shortcut-reset-all"
        focusableWhenDisabled
        disabled={!Object.keys(keyBindings).length}
        onClick={() => {
          resetKeyBindings();
          setStatus('All shortcuts restored to defaults.');
        }}
      >
        Restore all defaults
      </Button>
    </div>
  );
}
