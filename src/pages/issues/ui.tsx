import { useState, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  List,
  Columns3,
  Plus,
  Filter,
  Search,
  ChevronDown,
  ChevronRight,
  Save,
  RefreshCw,
  PanelLeft,
  Layers,
} from 'lucide-react';
import type { Issue, IssueFilters, IssueCreate, Status, StatusCategory } from '@tickets/contracts';
import { useIssues, IssueRow, StatusIcon } from '@/entities/issue';
import { useMe, useCatalog, useProjects, moduleEnabled } from '@/entities/workspace';
import { CreateIssue } from '@/features/issue-create';
import { usePreferences } from '@/features/preferences';
import { IssueDetails } from '@/widgets/issue-details';
import { IssueBoard } from '@/widgets/issue-board';
import {
  Button,
  Input,
  Picker,
  EmptyState,
  ErrorState,
  SkeletonRows,
  Modal,
  ActionMenu,
} from '@/shared/ui';
import { api, errorMessage } from '@/shared/api/client';
export function IssuesPage() {
  const { issueId } = useParams(),
    navigate = useNavigate(),
    location = useLocation(),
    [params, setParams] = useSearchParams(),
    prefs = usePreferences(),
    client = useQueryClient();
  const { data: catalog } = useCatalog(),
    { data: me } = useMe(),
    projects = useProjects(moduleEnabled(catalog, 'planning'));
  const selectionKey = location.pathname + '?' + params.toString();
  const [selection, setSelection] = useState({ key: selectionKey, ids: new Set<string>() });
  const selected = selection.key === selectionKey ? selection.ids : new Set<string>();
  const setSelected = (value: Set<string> | ((old: Set<string>) => Set<string>)) =>
    setSelection((previous) => ({
      key: selectionKey,
      ids:
        typeof value === 'function'
          ? value(previous.key === selectionKey ? previous.ids : new Set())
          : value,
    }));
  const [filterOpen, setFilterOpen] = useState(false),
    [createOpen, setCreateOpen] = useState(false),
    [defaults, setDefaults] = useState<Partial<IssueCreate>>({}),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [saveOpen, setSaveOpen] = useState(false),
    [viewName, setViewName] = useState('');
  const title = location.pathname.startsWith('/my-issues')
    ? 'My issues'
    : location.pathname.startsWith('/epics')
      ? 'Epics'
      : location.pathname.startsWith('/archive')
        ? 'Archive'
        : 'All issues';
  const filters = useMemo(() => {
    const f: IssueFilters = {};
    for (const key of [
      'q',
      'team_id',
      'status_id',
      'assignee_id',
      'project_id',
      'cycle_id',
      'label_id',
      'parent_id',
      'due_before',
    ] as const) {
      const v = params.get(key);
      if (v) f[key] = v;
    }
    if (params.has('priority')) f.priority = Number(params.get('priority'));
    if (params.has('category')) f.category = params.get('category') as StatusCategory;
    if (params.get('kind') === 'epic') f.kind = 'epic';
    if (title === 'My issues') f.assignee_id = 'me';
    if (title === 'Epics') f.kind = 'epic';
    if (title === 'Archive') f.archived = true;
    return f;
  }, [params, title]);
  const query = useIssues(filters),
    issues = query.data?.pages.flatMap((p) => p.data) ?? [];
  const statuses =
    catalog?.statuses.filter((s) => !filters.team_id || s.team_id === filters.team_id) ?? [];
  const readOnly = me?.role === 'viewer';
  const selectedRows = issues.filter((i) => selected.has(i.id));
  const bulk = useMutation({
    mutationFn: (status: string) =>
      api<Issue[]>('/v1/issues/bulk', {
        method: 'PATCH',
        json: {
          updates: selectedRows.map((issue) => ({
            id: issue.id,
            patch: { version: issue.version, status_id: status },
          })),
        },
      }),
    onSuccess: () => {
      setSelected(new Set());
      void client.invalidateQueries({ queryKey: ['issues'] });
      void client.invalidateQueries({ queryKey: ['projects'] });
    },
  });
  const save = useMutation({
    mutationFn: () =>
      api('/v1/views', { method: 'POST', json: { name: viewName, filters, shared: true } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['views'] });
      setSaveOpen(false);
      setViewName('');
    },
  });
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value || value === 'all') next.delete(key);
    else next.set(key, value);
    if (key === 'team_id') {
      next.delete('status_id');
      next.delete('cycle_id');
    }
    setParams(next, { replace: true });
  }
  function create(status?: Status) {
    setDefaults({
      team_id: status?.team_id ?? filters.team_id,
      status_id: status?.id,
      kind: title === 'Epics' ? 'epic' : 'issue',
      project_id: filters.project_id,
    });
    setCreateOpen(true);
  }
  if (issueId)
    return (
      <IssueDetails
        id={issueId}
        onClose={() => navigate('/issues' + (params.toString() ? '?' + params : ''))}
      />
    );
  return (
    <>
      <header className="page-toolbar">
        <Button
          className="mobile-only"
          variant="ghost"
          size="icon"
          aria-label="Open navigation"
          onClick={() => prefs.setSidebarOpen(true)}
        >
          <PanelLeft size={18} />
        </Button>
        <div className="page-heading">
          <Layers size={17} />
          <h1>{title}</h1>
          <span className="count-badge">
            {issues.length}
            {query.hasNextPage ? '+' : ''}
          </span>
        </div>
        <div className="toolbar-actions page-actions-pill">
          <Button
            variant="ghost"
            size="icon"
            className="desktop-refresh"
            aria-label="Refresh issues"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw size={14} className={query.isFetching ? 'spin' : ''} />
          </Button>
          <Button
            variant="default"
            size="sm"
            className="page-create-action"
            aria-label="New issue"
            onClick={() => create()}
            disabled={readOnly}
          >
            <Plus size={18} />
            <span className="page-create-label">New issue</span>
          </Button>
          <ActionMenu
            label="Issue actions"
            items={[
              {
                label: 'Refresh issues',
                onSelect: () => void query.refetch(),
                disabled: query.isFetching,
              },
              {
                label: filterOpen ? 'Hide filters' : 'Show filters',
                onSelect: () => setFilterOpen((o) => !o),
              },
              {
                label: 'Select loaded issues',
                onSelect: () => setSelected(new Set(issues.map((i) => i.id))),
                disabled: readOnly || !issues.length,
              },
            ]}
          />
        </div>
      </header>
      <div className="view-toolbar">
        <Button
          variant={filterOpen ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setFilterOpen((o) => !o)}
          aria-expanded={filterOpen}
        >
          <Filter size={14} />
          Filter
          {Object.keys(filters).length > 0 && (
            <span className="filter-count">{Object.keys(filters).length}</span>
          )}
        </Button>
        <div className="inline-search">
          <Search size={13} />
          <Input
            aria-label="Search issues"
            placeholder="Search issues…"
            value={params.get('q') ?? ''}
            onChange={(e) => setFilter('q', e.target.value)}
          />
        </div>
        <div className="view-toolbar-end">
          {moduleEnabled(catalog, 'views') && (
            <Button variant="ghost" size="sm" onClick={() => setSaveOpen(true)} disabled={readOnly}>
              <Save size={13} />
              <span className="wide-only">Save view</span>
            </Button>
          )}
          <div className="segmented-control" aria-label="View mode">
            <Button
              variant="ghost"
              size="icon"
              aria-label="List view"
              aria-pressed={prefs.view === 'list'}
              onClick={() => prefs.setView('list')}
            >
              <List size={15} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Board view"
              aria-pressed={prefs.view === 'board'}
              onClick={() => prefs.setView('board')}
            >
              <Columns3 size={15} />
            </Button>
          </div>
        </div>
      </div>
      {filterOpen && (
        <div className="filters-panel">
          <Picker
            aria-label="Filter by team"
            value={params.get('team_id') ?? 'all'}
            options={[
              { value: 'all', label: 'All teams' },
              ...(catalog?.teams.map((t) => ({ value: t.id, label: t.name })) ?? []),
            ]}
            onChange={(v) => setFilter('team_id', v)}
          />
          <Picker
            aria-label="Filter by assignee"
            value={params.get('assignee_id') ?? 'all'}
            options={[
              { value: 'all', label: 'All assignees' },
              { value: 'me', label: 'Assigned to me' },
              { value: 'unassigned', label: 'Unassigned' },
              ...(catalog?.people.map((p) => ({ value: p.id, label: p.name })) ?? []),
            ]}
            onChange={(v) => setFilter('assignee_id', v)}
          />
          <Picker
            aria-label="Filter by status"
            value={params.get('status_id') ?? 'all'}
            options={[
              { value: 'all', label: 'All statuses' },
              ...statuses.map((s) => ({ value: s.id, label: s.name })),
            ]}
            onChange={(v) => setFilter('status_id', v)}
          />
          <Picker
            aria-label="Filter by label"
            value={params.get('label_id') ?? 'all'}
            options={[
              { value: 'all', label: 'All labels' },
              ...(catalog?.labels.map((l) => ({ value: l.id, label: l.name })) ?? []),
            ]}
            onChange={(v) => setFilter('label_id', v)}
          />
          {moduleEnabled(catalog, 'planning') && (
            <Picker
              aria-label="Filter by project"
              value={params.get('project_id') ?? 'all'}
              options={[
                { value: 'all', label: 'All projects' },
                ...(projects.data?.map((p) => ({ value: p.id, label: p.name })) ?? []),
              ]}
              onChange={(v) => setFilter('project_id', v)}
            />
          )}
          <Button size="sm" variant="ghost" onClick={() => setParams({})}>
            Clear filters
          </Button>
        </div>
      )}
      {selected.size > 0 && (
        <div className="bulk-toolbar">
          <strong>{selected.size} selected</strong>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          {new Set(selectedRows.map((i) => i.team_id)).size === 1 ? (
            <Picker
              aria-label="Bulk change status"
              value="none"
              disabled={bulk.isPending}
              options={[
                { value: 'none', label: 'Change status…' },
                ...(catalog?.statuses
                  .filter((s) => s.team_id === selectedRows[0]?.team_id)
                  .map((s) => ({ value: s.id, label: s.name })) ?? []),
              ]}
              onChange={(v) => {
                if (v !== 'none') bulk.mutate(v);
              }}
            />
          ) : (
            <span className="muted">Select issues from one team to change their workflow.</span>
          )}
        </div>
      )}
      {bulk.error && <ErrorState message={errorMessage(bulk.error)} />}
      <div className="issues-content">
        {query.isPending ? (
          <SkeletonRows />
        ) : query.error ? (
          <ErrorState message={errorMessage(query.error)} retry={() => void query.refetch()} />
        ) : !issues.length ? (
          <EmptyState
            title={Object.keys(filters).length ? 'No matching issues' : 'A clear place to start'}
            description={
              Object.keys(filters).length
                ? 'Try adjusting your filters. Your issues have not been deleted.'
                : 'Give your next piece of work a name. The details can follow.'
            }
            action={!readOnly ? { label: 'Create issue', onClick: () => create() } : undefined}
          />
        ) : prefs.view === 'board' ? (
          <IssueBoard
            issues={issues}
            statuses={statuses}
            onOpen={(id) => navigate('/issues/' + id)}
            onCreate={create}
            readOnly={readOnly}
          />
        ) : (
          <div className="issue-list">
            {statuses
              .filter((s) => issues.some((i) => i.status_id === s.id))
              .map((s) => (
                <section className="issue-group" key={s.id}>
                  <header className="group-heading">
                    <button
                      type="button"
                      aria-expanded={!collapsed.has(s.id)}
                      onClick={() =>
                        setCollapsed((old) => {
                          const next = new Set(old);
                          if (next.has(s.id)) next.delete(s.id);
                          else next.add(s.id);
                          return next;
                        })
                      }
                    >
                      {collapsed.has(s.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                      <StatusIcon category={s.category} color={s.color} />
                      <h2>{s.name}</h2>
                      <span className="muted">
                        {issues.filter((i) => i.status_id === s.id).length}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Create ${s.name} issue`}
                      onClick={() => create(s)}
                      disabled={readOnly}
                    >
                      <Plus size={14} />
                    </Button>
                  </header>
                  {!collapsed.has(s.id) &&
                    issues
                      .filter((i) => i.status_id === s.id)
                      .map((i) => (
                        <IssueRow
                          key={i.id}
                          issue={i}
                          status={s}
                          canSelect={!readOnly}
                          selected={selected.has(i.id)}
                          onSelect={() =>
                            setSelected((old) => {
                              const next = new Set(old);
                              if (next.has(i.id)) next.delete(i.id);
                              else next.add(i.id);
                              return next;
                            })
                          }
                          onOpen={() =>
                            navigate('/issues/' + i.id + (params.toString() ? '?' + params : ''))
                          }
                        />
                      ))}
                </section>
              ))}
          </div>
        )}
        {query.hasNextPage && (
          <div className="load-more">
            <Button onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? 'Loading…' : 'Load more issues'}
            </Button>
          </div>
        )}
      </div>
      <footer className="page-statusbar">
        <span>{issues.length} issues loaded</span>
        <span>C to create · ⌘ K to search</span>
      </footer>
      {createOpen && (
        <CreateIssue open={createOpen} onOpenChange={setCreateOpen} defaults={defaults} />
      )}
      <Modal open={saveOpen} onOpenChange={setSaveOpen} title="Save this view">
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Input
            data-autofocus
            aria-label="View name"
            placeholder="e.g. Bugs ready for review"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            maxLength={100}
            required
          />
          <p className="muted">The current filters will be shared with your workspace.</p>
          {save.error && <ErrorState message={errorMessage(save.error)} />}
          <Button variant="default" type="submit" disabled={!viewName.trim() || save.isPending}>
            Save view
          </Button>
        </form>
      </Modal>
    </>
  );
}
