import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ChevronLeft, Layers } from 'lucide-react';
import type { Catalog, Issue, IssueCreate } from '@tickets/contracts';
import { IssueProperties } from '@/features/issue-properties';
import { useCatalog, useMe } from '@/entities/workspace';
import { api, errorMessage } from '@/shared/api/client';
import { Button, DocumentText, ErrorState } from '@/shared/ui';
import { useLatest, useScope, useStore } from '@/shared/lib/state/react';
import { sessionStoragePort } from '@/shared/lib/state/storage';
import { issueDraftKey, type Draft } from './model';
import { createIssueDraftController } from './draft-controller';

export function NewIssuePage() {
  const location = useLocation();
  return <IssueDraftPage key={location.key} />;
}
function postIssue(attempt: NonNullable<Draft['attempt']>) {
  return api<Issue>('/v1/issues', {
    method: 'POST',
    json: attempt.input,
    headers: { 'idempotency-key': attempt.key },
  });
}
/** TanStack Query is the labelled server-cache adapter: invalidate only, never own draft state. */
function invalidateAfterCreate(client: QueryClient) {
  void client.invalidateQueries({ queryKey: ['issues'] });
  void client.invalidateQueries({ queryKey: ['projects'] });
}
function useDraftController(key: string, incoming: Partial<IssueCreate>) {
  const client = useQueryClient(),
    navigate = useNavigate(),
    location = useLocation();
  const route = useLatest({ navigate, from: location.state?.from as string | undefined });
  const [controller] = useState(() =>
    createIssueDraftController({
      key,
      incoming,
      storage: sessionStoragePort(),
      submit: postIssue,
      describeError: errorMessage,
      onCreated: (issue, mounted) => {
        invalidateAfterCreate(client);
        if (!mounted) return;
        void route().navigate('/issues/' + issue.id, {
          replace: true,
          state: { from: route().from ?? '/issues' },
        });
      },
    }),
  );
  useScope(() => controller.scope);
  return controller;
}
function defaultStatus(catalog: Catalog | undefined, team: string) {
  return (
    catalog?.statuses.find((s) => s.team_id === team && s.category === 'unstarted')?.id ||
    catalog?.statuses.find((s) => s.team_id === team)?.id ||
    ''
  );
}
function IssueDraftPage() {
  const { data: catalog } = useCatalog(),
    { data: me } = useMe(),
    location = useLocation();
  const incoming = (location.state?.defaults ?? {}) as Partial<IssueCreate>;
  const controller = useDraftController(
    issueDraftKey(me?.workspace_id ?? '', me?.id ?? '', incoming),
    incoming,
  );
  const view = useStore(controller);
  const readOnly = me?.role === 'viewer',
    team = view.draft.team_id || catalog?.teams[0]?.id || '';
  const status = view.draft.status_id || defaultStatus(catalog, team);
  const context = useLatest({ team, status, readOnly });
  useUnloadAndSubmitKeys(controller, context);
  return (
    <section className="issue-detail-panel new-issue-page" aria-label="New issue">
      <NewIssueToolbar
        team={catalog?.teams.find((t) => t.id === team)?.name ?? 'Workspace'}
        kind={view.draft.kind}
        disabled={readOnly || view.pending || !view.draft.title.trim() || !team}
        label={view.pending ? 'Creating…' : view.draft.attempt ? 'Retry creation' : 'Create issue'}
        onCreate={() => void controller.create(context())}
      />
      <div className="detail-layout">
        <NewIssueBody view={view} controller={controller} readOnly={readOnly} />
        <aside className="detail-properties" aria-label="Issue properties">
          <IssueProperties
            value={{ ...view.draft, team_id: team, status_id: status }}
            disabled={view.frozen || readOnly}
            onChange={(patch) => controller.change(patch)}
            onTeamChange={(id) =>
              controller.change({
                team_id: id,
                status_id: '',
                project_id: null,
                cycle_id: null,
                milestone_id: null,
              })
            }
          />
        </aside>
      </div>
    </section>
  );
}
type Controller = ReturnType<typeof createIssueDraftController>;
function useUnloadAndSubmitKeys(
  controller: Controller,
  context: () => { team: string; status: string; readOnly: boolean },
) {
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (controller.hasUnsavedWork()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const submit = (e: KeyboardEvent) => {
      if (e.isComposing || !(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return;
      e.preventDefault();
      void controller.create(context());
    };
    window.addEventListener('beforeunload', warn);
    window.addEventListener('keydown', submit);
    return () => {
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener('keydown', submit);
    };
  }, [controller, context]);
}
function NewIssueToolbar(props: {
  team: string;
  kind: string;
  disabled: boolean;
  label: string;
  onCreate: () => void;
}) {
  const navigate = useNavigate(),
    location = useLocation();
  return (
    <header className="issue-detail-toolbar">
      <div className="breadcrumb">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to issues"
          onClick={() => navigate(location.state?.from ?? '/issues')}
        >
          <ChevronLeft size={16} />
        </Button>
        <Layers size={14} />
        <span>{props.team}</span>
        <span className="muted">/</span>
        <span>New {props.kind}</span>
      </div>
      <div className="toolbar-actions">
        <span className="muted draft-save-status">Private draft</span>
        <Button variant="default" size="sm" disabled={props.disabled} onClick={props.onCreate}>
          {props.label}
        </Button>
      </div>
    </header>
  );
}
function NewIssueBody({
  view,
  controller,
  readOnly,
}: {
  view: ReturnType<Controller['getSnapshot']>;
  controller: Controller;
  readOnly: boolean;
}) {
  return (
    <div className="detail-main">
      <DocumentText
        title={view.draft.title}
        description={view.draft.description}
        onChange={(field, value) => controller.change({ [field]: value })}
        readOnly={readOnly || view.frozen}
      />
      {view.storageError && (
        <ErrorState message="Browser storage is unavailable. Keep this page open to retain your draft." />
      )}
      {view.error && <ErrorState message={view.error} />}
      {view.draft.attempt && !view.pending && (
        <p className="section-hint">
          The request may already have succeeded. Retry sends the same request safely; editing is
          paused to prevent duplicate issues.
        </p>
      )}
      <p className="document-create-hint">
        ⌘ / Ctrl Enter to create · Your draft stays here until you create it.
      </p>
    </div>
  );
}
