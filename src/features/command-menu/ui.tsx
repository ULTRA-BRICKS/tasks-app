/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Editable ARIA combobox with virtual-focus listbox. */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, ArrowRight } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMe, useCatalog, moduleEnabled } from '@/entities/workspace';
import { Modal, Input } from '@/shared/ui';
import { api } from '@/shared/api/client';
import { copyObject } from '@/shared/lib/interaction/copy';
type Result = { id: string; label: string; kind: string; action: () => void };
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
    location = useLocation(),
    client = useQueryClient(),
    list = useRef<HTMLDivElement>(null);
  const { data: me } = useMe(),
    { data: catalog } = useCatalog();
  const readOnly = me?.role === 'viewer';
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 150);
    return () => clearTimeout(timer);
  }, [query]);
  const found = useQuery({
    queryKey: ['command-search', me?.workspace_id, debounced],
    enabled: open && Boolean(debounced),
    queryFn: async ({ signal }) => {
      const paths = ['/v1/issues?q=' + encodeURIComponent(debounced)];
      if (moduleEnabled(catalog, 'planning'))
        paths.push('/v1/projects', '/v1/documents', '/v1/initiatives');
      const responses = await Promise.allSettled(
        paths.map((path) => api<unknown>(path, { signal })),
      );
      const rows: Result[] = [];
      responses.forEach((response, i) => {
        if (response.status !== 'fulfilled') return;
        const body = response.value as { data?: unknown[] },
          values = Array.isArray(body) ? body : body?.data;
        if (!Array.isArray(values)) return;
        const kind = i === 0 ? 'Issue' : i === 1 ? 'Project' : i === 2 ? 'Document' : 'Initiative';
        const route =
          i === 0 ? '/issues/' : i === 1 ? '/projects/' : i === 2 ? '/documents/' : '/initiatives/';
        for (const value of values) {
          const item = value as { id?: string; key?: string; title?: string; name?: string };
          const title = item.title ?? item.name;
          if (
            !item.id ||
            !title ||
            (i > 0 && !title.toLowerCase().includes(debounced.toLowerCase()))
          )
            continue;
          rows.push({
            id: kind + item.id,
            label: (item.key ? item.key + '  ' : '') + title,
            kind,
            action: () => {
              void navigate(route + item.id);
            },
          });
          if (rows.filter((row) => row.kind === kind).length >= 8) break;
        }
      });
      return { rows, unavailable: responses.some((response) => response.status === 'rejected') };
    },
  });
  const actions: Result[] = [
    ...(!readOnly
      ? [{ id: 'create', label: 'Create new issue', kind: 'Action', action: onCreate }]
      : []),
    ...[
      ['/issues', 'Go to all issues'],
      ['/my-issues', 'Go to my issues'],
      ['/inbox', 'Go to inbox'],
      ['/settings', 'Open settings'],
      ...(moduleEnabled(catalog, 'planning')
        ? [
            ['/projects', 'Go to projects'],
            ['/cycles', 'Go to cycles'],
            ['/documents', 'Go to documents'],
            ['/initiatives', 'Go to initiatives'],
            ...(!readOnly
              ? [
                  ['/documents/new', 'Create new document'],
                  ['/projects/new', 'Create new project'],
                  ['/initiatives/new', 'Create new initiative'],
                ]
              : []),
          ]
        : []),
      ...(['owner', 'admin'].includes(me?.role ?? '')
        ? [['/settings?tab=members', 'Invite a teammate']]
        : []),
    ].map(([path, label]) => ({
      id: path,
      label,
      kind: 'Action',
      action: () => {
        void navigate(path);
      },
    })),
  ];
  const match = location.pathname.match(/^\/(issues|documents|projects|initiatives)\/([^/]+)$/);
  if (match && match[2] !== 'new') {
    const item = client.getQueryData<{
      key?: string;
      title?: string;
      name?: string;
      description?: string;
      body?: string;
    }>([match[1] === 'issues' ? 'issue' : match[1], match[2]]);
    if (item)
      for (const [format, label] of [
        ['copyLink', 'Copy link'],
        ['copyId', 'Copy identifier'],
        ['copyMarkdown', 'Copy Markdown'],
        ['copyLinkedTitle', 'Copy linked title'],
        ['copyBranch', 'Copy branch name'],
        ['copyPrompt', 'Copy prompt'],
      ])
        actions.push({
          id: format,
          label,
          kind: 'Copy',
          action: () => {
            void copyObject(
              {
                key: item.key,
                title: item.title ?? item.name ?? '',
                body: item.body ?? item.description,
                url: new URL(location.pathname, window.location.origin).href,
              },
              format,
            );
          },
        });
  }
  const results = [
    ...actions.filter((action) => action.label.toLowerCase().includes(query.toLowerCase())),
    ...(query.trim() && debounced === query.trim() ? (found.data?.rows ?? []) : []),
  ];
  const current = Math.min(index, Math.max(0, results.length - 1));
  useEffect(() => {
    list.current
      ?.querySelector(`[data-command-index="${current}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setQuery('');
      setIndex(0);
    }
  };
  const choose = (n: number) => {
    const row = results[n];
    if (row) {
      close(false);
      row.action();
    }
  };
  return (
    <Modal open={open} onOpenChange={close} title="Command menu" className="command-dialog">
      <div className="command-search">
        <Search size={18} />
        <Input
          data-autofocus
          aria-label="Search commands and issues"
          placeholder="Search actions, issues, projects and documents…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
              e.preventDefault();
              e.stopPropagation();
              close(false);
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex(Math.min(current + 1, results.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex(Math.max(current - 1, 0));
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              choose(current);
            }
          }}
          aria-controls="command-results"
          aria-activedescendant={results[current] ? 'command-' + current : undefined}
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
        {results.map((row, n) => (
          <div
            role="option"
            tabIndex={-1}
            aria-selected={current === n}
            id={'command-' + n}
            key={row.id}
            data-command-index={n}
            className={'command-row' + (current === n ? ' highlighted' : '')}
            onMouseMove={() => setIndex(n)}
            onClick={() => choose(n)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                choose(n);
              }
            }}
          >
            <ArrowRight size={16} />
            <span>{row.label}</span>
            <small className="muted">{row.kind}</small>
            <kbd>↵</kbd>
          </div>
        ))}
        {query.trim() && (found.isFetching || debounced !== query.trim()) && (
          <output className="muted">Searching…</output>
        )}
        {query.trim() && (found.error || found.data?.unavailable) && (
          <p role="alert" className="muted">
            Some results are unavailable. Actions remain available; retry your search.
          </p>
        )}
        {!results.length && !found.isFetching && (
          <p className="muted">No matching actions or objects.</p>
        )}
      </div>
      <div className="command-footer">
        ↑ ↓ to navigate<span>↵ to select · Esc to close</span>
      </div>
    </Modal>
  );
}
