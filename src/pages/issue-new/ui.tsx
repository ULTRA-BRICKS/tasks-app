import { IssueProperties } from '@/features/issue-properties';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Layers } from 'lucide-react';
import type { Issue, IssueCreate } from '@tickets/contracts';
import { useCatalog, useMe } from '@/entities/workspace';
import { api, errorMessage, ApiError } from '@/shared/api/client';
import { Button, DocumentText, ErrorState } from '@/shared/ui';
interface Draft {
  title: string;
  description: string;
  team_id: string;
  status_id: string;
  priority: number;
  assignee_id: string | null;
  project_id: string | null;
  cycle_id: string | null;
  parent_id: string | null;
  kind: 'issue' | 'epic';
  label_ids: string[];
  due_date: string | null;
  start_date?: string | null;
  estimate?: number | null;
  milestone_id?: string | null;
  attempt?: { key: string; input: IssueCreate };
}
export function NewIssuePage() {
  const { data: catalog } = useCatalog(),
    { data: me } = useMe(),
    navigate = useNavigate(),
    location = useLocation();
  const client = useQueryClient();
  const incoming = (location.state?.defaults ?? {}) as Partial<IssueCreate>;
  const key = `ticket-new:${me?.id}:${me?.workspace_id}:${incoming.parent_id ?? incoming.project_id ?? 'root'}`;
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Draft | null;
      if (
        saved &&
        typeof saved.title === 'string' &&
        saved.title.length <= 300 &&
        typeof saved.description === 'string' &&
        saved.description.length <= 100000 &&
        Array.isArray(saved.label_ids)
      )
        return saved;
    } catch {
      /* Use an empty private draft when storage is unavailable. */
    }
    return {
      title: '',
      description: '',
      team_id: incoming.team_id ?? '',
      status_id: incoming.status_id ?? '',
      priority: incoming.priority ?? 0,
      assignee_id: incoming.assignee_id ?? null,
      project_id: incoming.project_id ?? null,
      cycle_id: incoming.cycle_id ?? null,
      parent_id: incoming.parent_id ?? null,
      kind: incoming.kind ?? 'issue',
      label_ids: [],
      due_date: null,
    };
  });
  const [storageError, setStorageError] = useState(false),
    lock = useRef(false),
    current = useRef(draft);
  const readOnly = me?.role === 'viewer',
    team = draft.team_id || catalog?.teams[0]?.id || '';
  const status =
    draft.status_id ||
    catalog?.statuses.find((s) => s.team_id === team && s.category === 'unstarted')?.id ||
    catalog?.statuses.find((s) => s.team_id === team)?.id ||
    '';
  function change(patch: Partial<Draft>) {
    const next = { ...current.current, ...patch };
    current.current = next;
    setDraft(next);
    try {
      sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      setStorageError(true);
    }
  }
  const mutation = useMutation({
    mutationFn: (attempt: NonNullable<Draft['attempt']>) =>
      api<Issue>('/v1/issues', {
        method: 'POST',
        json: attempt.input,
        headers: { 'idempotency-key': attempt.key },
      }),
    onSuccess: (issue) => {
      try {
        sessionStorage.removeItem(key);
      } catch {}
      void client.invalidateQueries({ queryKey: ['issues'] });
      void client.invalidateQueries({ queryKey: ['projects'] });
      void navigate('/issues/' + issue.id, {
        replace: true,
        state: { from: location.state?.from ?? '/issues' },
      });
    },
  });
  const frozen = mutation.isPending || Boolean(draft.attempt);
  async function create() {
    if (lock.current || readOnly || !team || !current.current.title.trim()) return;
    lock.current = true;
    const d = current.current;
    const attempt = d.attempt ?? {
      key: crypto.randomUUID(),
      input: {
        title: d.title.trim(),
        description: d.description,
        team_id: team,
        status_id: status,
        priority: d.priority,
        assignee_id: d.assignee_id,
        project_id: d.project_id,
        cycle_id: d.cycle_id,
        parent_id: d.parent_id,
        kind: d.kind,
        label_ids: d.label_ids,
        due_date: d.due_date,
      },
    };
    change({ attempt });
    try {
      await mutation.mutateAsync(attempt);
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 408 &&
        e.status !== 409
      )
        change({ attempt: undefined });
    } finally {
      lock.current = false;
    }
  }
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (current.current.title || current.current.description) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (!e.isComposing && (e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void create();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  });
  return (
    <section className="issue-detail-panel new-issue-page" aria-label="New issue">
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
          <span>{catalog?.teams.find((t) => t.id === team)?.name ?? 'Workspace'}</span>
          <span className="muted">/</span>
          <span>New {draft.kind}</span>
        </div>
        <div className="toolbar-actions">
          <span className="muted draft-save-status">Private draft</span>
          <Button
            variant="default"
            size="sm"
            disabled={readOnly || mutation.isPending || !draft.title.trim() || !team}
            onClick={() => void create()}
          >
            {mutation.isPending ? 'Creating…' : draft.attempt ? 'Retry creation' : 'Create issue'}
          </Button>
        </div>
      </header>
      <div className="detail-layout">
        <div className="detail-main">
          <DocumentText
            title={draft.title}
            description={draft.description}
            onChange={(field, value) => change({ [field]: value })}
            readOnly={readOnly || frozen}
          />
          {storageError && (
            <ErrorState message="Browser storage is unavailable. Keep this page open to retain your draft." />
          )}
          {mutation.error && <ErrorState message={errorMessage(mutation.error)} />}
          {draft.attempt && !mutation.isPending && (
            <p className="section-hint">
              The request may already have succeeded. Retry sends the same request safely; editing
              is paused to prevent duplicate issues.
            </p>
          )}
          <p className="document-create-hint">
            ⌘ / Ctrl Enter to create · Your draft stays here until you create it.
          </p>
        </div>
        <aside className="detail-properties" aria-label="Issue properties">
          <IssueProperties
            value={{ ...draft, team_id: team, status_id: status }}
            disabled={frozen || readOnly}
            onChange={(patch) => change(patch)}
            onTeamChange={(id) =>
              change({
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
