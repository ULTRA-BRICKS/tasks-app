import { draftPersistence, draftBelongsTo } from '@/shared/lib/draft-persistence';
import { IssueProperties } from '@/features/issue-properties';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Layers } from 'lucide-react';
import type { Issue, IssueCreate } from '@tickets/contracts';
import { useCatalog, useMe } from '@/entities/workspace';
import { api, errorMessage, ApiError } from '@/shared/api/client';
import { Button, DocumentText, ErrorState } from '@/shared/ui';
import { newIssueDraft, createIssueInput, issueDraftKey, type Draft } from './model';

export function NewIssuePage() {
  const location = useLocation();
  return <IssueDraftPage key={location.key} />;
}
function IssueDraftPage() {
  const { data: catalog } = useCatalog(),
    { data: me } = useMe(),
    navigate = useNavigate(),
    location = useLocation();
  const client = useQueryClient();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const incoming = (location.state?.defaults ?? {}) as Partial<IssueCreate>;
  const restoredKey = location.state?.restoreKey as unknown;
  const key =
    me &&
    typeof restoredKey === 'string' &&
    restoredKey.startsWith('ticket-new:') &&
    draftBelongsTo(restoredKey, me)
      ? restoredKey
      : issueDraftKey(me?.workspace_id ?? '', me?.id ?? '', incoming);
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = JSON.parse(draftPersistence.getItem(key) ?? 'null') as Draft | null;
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
    return newIssueDraft(incoming);
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
      draftPersistence.setItem(key, JSON.stringify(next));
    } catch {
      setStorageError(true);
    }
  }
  const mutation = useMutation({
    mutationFn: async (attempt: NonNullable<Draft['attempt']>) => {
      const submittedCopy = draftPersistence.capture(key);
      const issue = await api<Issue>('/v1/issues', {
        method: 'POST',
        json: attempt.input,
        headers: { 'idempotency-key': attempt.key },
      });
      return { issue, submittedCopy };
    },
    onSuccess: ({ issue, submittedCopy }) => {
      try {
        if (submittedCopy) draftPersistence.acknowledge(submittedCopy);
      } catch {
        if (mounted.current) setStorageError(true);
      }
      if (!mounted.current) {
        void client.invalidateQueries({ queryKey: ['issues'] });
        return;
      }
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
      input: createIssueInput(d, team, status),
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
