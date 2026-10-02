import { useState } from 'react';
import { Modal, Input, Button, ErrorState } from '@/shared/ui';
import { commands, type Command } from '@/shared/lib/interaction/commands';
import { formatKey, normalizeShortcut } from '@/shared/lib/interaction/keys';
import { useShortcutSettings } from '@/shared/lib/interaction/preferences';
export function Keycaps({ value }: { value: string }) {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <span className="shortcut-keycaps" aria-label={value}>
      {value.split(' ').map((stroke, n) => (
        <span className="shortcut-stroke" key={n}>
          {n > 0 && <small>then</small>}
          {stroke.split('+').map((key, i) => (
            <kbd key={i}>{formatKey(key, mac)}</kbd>
          ))}
        </span>
      ))}
    </span>
  );
}
function ShortcutRow({ command }: { command: Command }) {
  const settings = useShortcutSettings(),
    keys = settings.bindings[command.id] ?? command.keys;
  const [editing, setEditing] = useState(false),
    [value, setValue] = useState(''),
    [error, setError] = useState('');
  return (
    <div className="shortcut-config-row">
      <span>{command.label}</span>
      {!editing ? (
        <button
          className="shortcut-binding"
          type="button"
          aria-label={'Customize ' + command.label}
          onClick={() => {
            setValue(keys.join('; '));
            setEditing(true);
          }}
        >
          {keys.length ? (
            keys.map((key) => <Keycaps key={key} value={key} />)
          ) : (
            <span className="muted">Not assigned</span>
          )}
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = value.trim() ? value.split(';').map(normalizeShortcut) : [];
            if (parsed.some((key) => !key)) return setError('Use keys like Mod+K or G P.');
            const failure = settings.change(command.id, parsed as string[]);
            setError(failure ?? '');
            if (!failure) setEditing(false);
          }}
        >
          <Input
            data-autofocus
            aria-label={'Shortcut for ' + command.label}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setEditing(false);
              }
            }}
          />
          <Button type="submit" size="sm">
            Save
          </Button>
          <Button type="button" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          {error && <ErrorState message={error} />}
        </form>
      )}
    </div>
  );
}
export function InteractionHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const settings = useShortcutSettings(),
    [query, setQuery] = useState('');
  const filtered = commands.filter((c) =>
    (c.label + ' ' + c.group + ' ' + (settings.bindings[c.id] ?? c.keys).join(' '))
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <Modal
      title="Keyboard shortcuts"
      open={open}
      onOpenChange={onOpenChange}
      className="keyboard-panel"
    >
      <Input
        data-autofocus
        aria-label="Search shortcuts"
        placeholder="Search shortcuts…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="muted">
        Click a shortcut to customize it. Mod means ⌘ on Mac or Ctrl elsewhere; separate
        alternatives with semicolons. Text editing keeps its own shortcuts.
      </p>
      <div className="shortcut-options">
        <Button size="sm" aria-pressed={settings.enabled} onClick={settings.toggle}>
          {settings.enabled ? 'Shortcuts enabled' : 'Shortcuts disabled'}
        </Button>
        <Button size="sm" onClick={settings.reset}>
          Reset shortcuts
        </Button>
      </div>
      {settings.error && <ErrorState message={settings.error} />}
      <div className="shortcut-scroll">
        {[...new Set(filtered.map((c) => c.group))].map((group) => (
          <section key={group}>
            <h2>{group}</h2>
            {filtered
              .filter((c) => c.group === group)
              .map((command) => (
                <ShortcutRow key={command.id} command={command} />
              ))}
          </section>
        ))}
        <section>
          <h2>Native controls</h2>
          <p>
            Esc closes the current menu, cancels an inline edit, clears selection or returns to the
            list—in that order. Shift-click selects a range. Enter opens the focused item. Text
            selection and editor Undo/Redo stay native.
          </p>
        </section>
      </div>
    </Modal>
  );
}
