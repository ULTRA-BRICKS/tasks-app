/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Editable combobox with a virtual-focus ARIA listbox, not a native select. */
import './style.css';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Calendar,
  FolderKanban,
  Inbox,
  Keyboard,
  Layers,
  Plus,
  Redo2,
  Search,
  Settings,
  Undo2,
  User,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Role } from '@tickets/contracts';
import { useIssues } from '@/entities/issue';
import { workspaceCommands } from '@/shared/lib/command-catalog';
import { commandAvailable, paletteCommands } from '@/shared/lib/commands';
import { CommandKeycaps, Input, Modal } from '@/shared/ui';

const icons: Record<string, LucideIcon> = {
  'help.open': Keyboard,
  'task.create': Plus,
  'nav.tasks': Layers,
  'nav.my-tasks': User,
  'nav.projects': FolderKanban,
  'nav.cycles': Calendar,
  'nav.inbox': Inbox,
  'nav.settings': Settings,
  'edit.undo': Undo2,
  'edit.redo': Redo2,
};
const menuCommands = paletteCommands(workspaceCommands);

/**
 * ⌘K / Ctrl K: the registry's commands (with their keycaps) followed by matching tasks. A
 * command runs through `onRun`, the same path as its key; commands the role cannot use are
 * listed but disabled.
 */
export function CommandMenu({
  open,
  onOpenChange,
  onRun,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRun: (commandId: string) => void;
  role: Role | undefined;
}) {
  const [query, setQuery] = useState(''),
    [index, setIndex] = useState(0),
    [debounced, setDebounced] = useState('');
  const navigate = useNavigate(),
    list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 180);
    return () => clearTimeout(timer);
  }, [query]);
  const issues = useIssues({ q: debounced }, { enabled: open && Boolean(debounced.trim()) });
  // Keep the old issue search terms working after the UI rename.
  const commandQuery = query
    .toLowerCase()
    .replace(/\bissues\b/g, 'tasks')
    .replace(/\bissue\b/g, 'task');
  const results = [
    ...menuCommands
      .filter((command) => command.title.toLowerCase().includes(commandQuery.trim()))
      .map((command) => ({
        id: command.id,
        label: command.title,
        icon: icons[command.id] ?? ArrowRight,
        command: command.id,
        disabled: !commandAvailable(command, role),
        action: () => onRun(command.id),
      })),
    ...(query.trim()
      ? (issues.data?.pages[0]?.data.slice(0, 8).map((i) => ({
          id: i.id,
          label: `${i.key}  ${i.title}`,
          icon: ArrowRight,
          command: undefined,
          disabled: false,
          action: () => void navigate('/tasks/' + i.id),
        })) ?? [])
      : []),
  ];
  useEffect(() => {
    list.current
      ?.querySelector(`[data-command-index="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  const choose = (n: number) => {
    const row = results[n];
    if (row && !row.disabled) {
      onOpenChange(false);
      setQuery('');
      row.action();
    }
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Command menu" className="command-dialog">
      <div className="command-search">
        <Search size={18} />
        <Input
          data-autofocus
          aria-label="Search commands and tasks"
          placeholder="Search tasks or type a command…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.max(0, Math.min(i + 1, results.length - 1)));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              choose(index);
            }
          }}
          aria-controls="command-results"
          aria-activedescendant={results[index] ? 'command-' + results[index].id : undefined}
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
        />
      </div>
      <div
        id="command-results"
        role="listbox"
        aria-label="Commands and tasks"
        className="command-results"
        ref={list}
      >
        {results.map((r, i) => (
          <div
            role="option"
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                choose(i);
              }
            }}
            aria-selected={index === i}
            aria-disabled={r.disabled || undefined}
            id={'command-' + r.id}
            key={r.id}
            data-command-index={i}
            className={'command-row' + (index === i ? ' highlighted' : '')}
            onMouseMove={() => setIndex(i)}
            onClick={() => choose(i)}
          >
            <r.icon size={16} />
            <span className="command-label">{r.label}</span>
            {r.command ? <CommandKeycaps command={r.command} /> : <span className="muted">↵</span>}
          </div>
        ))}
        {!results.length && <p className="muted">No matching commands or tasks.</p>}
      </div>
      <div className="command-footer">
        ↑ ↓ to navigate <span>↵ to select · esc to close</span>
      </div>
    </Modal>
  );
}
