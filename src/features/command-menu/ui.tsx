/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Editable combobox with a virtual-focus ARIA listbox, not a native select. */
import { useEffect, useRef, useState } from 'react';
import { Search, Plus, Inbox, Layers, Settings, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useIssues } from '@/entities/issue';
import { Modal, Input } from '@/shared/ui';
export function CommandMenu({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: () => void;
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
  const issues = useIssues({ q: debounced });
  const commands = [
    { id: 'create', label: 'Create new issue', icon: Plus, action: onCreate },
    { id: 'issues', label: 'Go to all issues', icon: Layers, action: () => navigate('/issues') },
    { id: 'inbox', label: 'Go to inbox', icon: Inbox, action: () => navigate('/inbox') },
    { id: 'settings', label: 'Open settings', icon: Settings, action: () => navigate('/settings') },
  ].filter((c) => c.label.toLowerCase().includes(query.toLowerCase()));
  const results = [
    ...commands,
    ...(query.trim()
      ? (issues.data?.pages[0]?.data.slice(0, 8).map((i) => ({
          id: i.id,
          label: `${i.key}  ${i.title}`,
          icon: ArrowRight,
          action: () => navigate('/issues/' + i.id),
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
    if (row) {
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
          aria-label="Search commands and issues"
          placeholder="Search issues or type a command…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, results.length - 1));
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
        aria-label="Commands and issues"
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
            id={'command-' + r.id}
            key={r.id}
            data-command-index={i}
            className={'command-row' + (index === i ? ' highlighted' : '')}
            onMouseMove={() => setIndex(i)}
            onClick={() => choose(i)}
          >
            <r.icon size={16} />
            <span>{r.label}</span>
            <span className="muted">↵</span>
          </div>
        ))}
        {!results.length && <p className="muted">No matching commands or issues.</p>}
      </div>
      <div className="command-footer">
        ↑ ↓ to navigate <span>↵ to select · esc to close</span>
      </div>
    </Modal>
  );
}
