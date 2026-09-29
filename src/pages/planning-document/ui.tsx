import { personOptions, canonicalPersonValue } from '@/shared/lib/people';
import { mergeVersioned } from '@/shared/lib/versioned';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Folder, CalendarRange } from 'lucide-react';
import { useCatalog, useMe, useProjects, useCycles, moduleEnabled } from '@/entities/workspace';
import { DateProperty } from '@/features/issue-properties';
import { Button, Combobox, DocumentText, InlineTitle, Loading, ErrorState } from '@/shared/ui';
import { api, errorMessage, ApiError } from '@/shared/api/client';
interface Plan {
  id: string;
  name: string;
  description?: string;
  version: number;
  team_id?: string;
  team_ids?: string[];
  start_date: string | null;
  target_date?: string | null;
  end_date?: string;
  status?: string;
  health?: string;
  lead_id?: string | null;
}
interface Draft {
  name: string;
  description: string;
  team: string;
  start: string;
  end: string;
  status: string;
  health: string;
  lead: string | null;
  version: number;
  attempt?: { key: string; input: Record<string, unknown> };
}
function planDraft(server: Plan | undefined, team = ''): Draft {
  return {
    name: server?.name ?? '',
    description: server?.description ?? '',
    team: server?.team_id ?? server?.team_ids?.[0] ?? team,
    start: server?.start_date ?? '',
    end: server?.target_date ?? server?.end_date ?? '',
    status: server?.status ?? 'planned',
    health: server?.health ?? 'on_track',
    lead: server?.lead_id ?? null,
    version: server?.version ?? 0,
  };
}
function sameDraft(a: Draft, b: Draft) {
  return (
    ['name', 'description', 'team', 'start', 'end', 'status', 'health', 'lead'] as const
  ).every((k) => a[k] === b[k]);
}
/** Router state from a picker's page-first Create: a typed name and where to return. */
interface PlanOrigin {
  name?: string;
  team?: string;
  from?: string;
  fromState?: unknown;
}
function planOrigin(state: unknown): PlanOrigin {
  const origin: PlanOrigin = {};
  if (!state || typeof state !== 'object') return origin;
  // Only same-application paths are followed back; router state is not a trusted URL.
  if ('from' in state && typeof state.from === 'string' && /^\/(?!\/)/.test(state.from)) {
    origin.from = state.from;
    if ('fromState' in state) origin.fromState = state.fromState;
  }
  if ('defaults' in state && state.defaults && typeof state.defaults === 'object') {
    const defaults = state.defaults;
    if ('name' in defaults && typeof defaults.name === 'string')
      origin.name = defaults.name.slice(0, 200);
    if ('team_id' in defaults && typeof defaults.team_id === 'string')
      origin.team = defaults.team_id;
  }
  return origin;
}
export function PlanningDocumentPage({ kind }: { kind: 'projects' | 'cycles' }) {
  const { id } = useParams(),
    location = useLocation(),
    { data: catalog } = useCatalog();
  const enabled = moduleEnabled(catalog, kind === 'projects' ? 'planning' : 'cycles');
  const projects = useProjects(enabled && kind === 'projects'),
    cycles = useCycles(enabled && kind === 'cycles');
  const query = kind === 'projects' ? projects : cycles;
  if (!enabled) return <ErrorState message="An administrator must enable this module first." />;
  if (id !== 'new' && query.isPending) return <Loading />;
  if (query.error) return <ErrorState message={errorMessage(query.error)} />;
  const existing = query.data?.find((p) => p.id === id) as Plan | undefined;
  if (id !== 'new' && !existing)
    return <ErrorState message="This item was not found in your workspace." />;
  return (
    <PlanEditor
      // Each visit to a new draft is its own editor; its defaults select the draft slot.
      key={kind + id + (existing ? '' : location.key)}
      kind={kind}
      existing={existing}
      origin={planOrigin(location.state)}
    />
  );
}
function serverPlan(server: Plan, current: Draft): Draft {
  return {
    ...current,
    name: server.name,
    description: server.description ?? '',
    team: server.team_id ?? server.team_ids?.[0] ?? current.team,
    start: server.start_date ?? '',
    end: server.target_date ?? server.end_date ?? '',
    status: server.status ?? 'planned',
    health: server.health ?? 'on_track',
    lead: server.lead_id ?? null,
    version: server.version,
    attempt: undefined,
  };
}
function PlanEditor({
  kind,
  existing,
  origin,
}: {
  kind: 'projects' | 'cycles';
  existing?: Plan;
  origin: PlanOrigin;
}) {
  const { data: catalog } = useCatalog(),
    { data: me } = useMe(),
    navigate = useNavigate(),
    client = useQueryClient();
  const noun = kind === 'projects' ? 'project' : 'cycle',
    readonly = me?.role === 'viewer';
  const prefill = existing ? undefined : origin.name;
  const team = catalog?.teams.some((t) => t.id === origin.team)
    ? origin.team
    : catalog?.teams[0]?.id;
  // A picker's typed name gets its own draft slot, never overwriting an unrelated new draft.
  // The slot follows the router state, not the catalog-resolved team, so it stays stable.
  const storageKey = [
    'plan-draft',
    me?.workspace_id,
    me?.id,
    kind,
    existing?.id ?? 'new',
    ...(prefill === undefined
      ? []
      : [origin.team, prefill].map((part) => encodeURIComponent(part ?? ''))),
  ].join(':');
  const initial = {
    ...planDraft(existing, team ?? ''),
    ...(prefill === undefined ? {} : { name: prefill }),
  };
  const back = origin.from
    ? {
        to: origin.from,
        state: origin.fromState,
        label: origin.from.startsWith('/tasks/new')
          ? 'new task'
          : origin.from.startsWith('/tasks/')
            ? 'task'
            : 'previous page',
      }
    : { to: '/' + kind, state: undefined, label: kind };
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as Draft | null;
      if (
        saved &&
        typeof saved.name === 'string' &&
        typeof saved.description === 'string' &&
        Number.isSafeInteger(saved.version)
      )
        return saved;
    } catch {}
    return initial;
  });
  const base = useRef(initial);
  const current = useRef(draft),
    version = useRef(draft.version),
    lock = useRef(false),
    requested = useRef(false),
    unsaved = useRef(!sameDraft(draft, initial)),
    editing = useRef(false),
    latestServer = useRef(existing);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [conflict, setConflict] = useState<Plan | null>(null),
    [storageError, setStorageError] = useState(false);
  const syncClean = useCallback(() => {
    const server = latestServer.current;
    if (
      !server ||
      server.version <= version.current ||
      unsaved.current ||
      editing.current ||
      lock.current
    )
      return;
    const next = serverPlan(server, current.current);
    base.current = next;
    version.current = server.version;
    current.current = next;
    setDraft(next);
  }, []);
  useEffect(() => {
    if (existing && (!latestServer.current || existing.version >= latestServer.current.version))
      latestServer.current = existing;
    syncClean();
  }, [existing, syncClean]);
  function change(patch: Partial<Draft>) {
    const next = { ...current.current, ...patch };
    unsaved.current = !sameDraft(next, base.current);
    current.current = next;
    setDraft(next);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      setStorageError(true);
    }
  }
  function payload(d: Draft): Record<string, unknown> {
    return kind === 'projects'
      ? {
          name: d.name.trim(),
          description: d.description,
          ...(!existing ? { team_ids: [d.team] } : {}),
          start_date: d.start || null,
          target_date: d.end || null,
          status: d.status,
          health: d.health,
          lead_id: d.lead,
        }
      : {
          name: d.name.trim(),
          ...(!existing ? { team_id: d.team } : {}),
          start_date: d.start,
          end_date: d.end,
        };
  }
  async function save() {
    if (readonly) return;
    if (existing && !unsaved.current) {
      syncClean();
      return;
    }
    requested.current = true;
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      do {
        requested.current = false;
        const sent = { ...current.current };
        if (!sent.name.trim() || (kind === 'cycles' && (!sent.start || !sent.end))) {
          setError('A name and valid cycle dates are required. Your draft is kept.');
          break;
        }
        let input = payload(sent);
        let key: string | undefined;
        if (!existing) {
          const attempt = sent.attempt ?? { key: crypto.randomUUID(), input };
          input = attempt.input;
          key = attempt.key;
          change({ attempt });
        }
        try {
          const result = await api<Plan>('/v1/' + kind + (existing ? '/' + existing.id : ''), {
            method: existing ? 'PATCH' : 'POST',
            json: existing ? { ...input, version: version.current } : input,
            ...(key ? { headers: { 'idempotency-key': key } } : {}),
          });
          if (!latestServer.current || result.version >= latestServer.current.version)
            latestServer.current = result;
          // Never pair a refetched v3 with fields acknowledged by v2. After unlocking,
          // syncClean adopts the complete newer server object; dirty drafts keep v2
          // and must resolve a conflict instead of silently overwriting remote text.
          version.current = Math.max(version.current, result.version);
          const acknowledged = planDraft(result, sent.team);
          const preserved = { ...current.current, version: version.current };
          for (const field of [
            'name',
            'description',
            'team',
            'start',
            'end',
            'status',
            'health',
            'lead',
          ] as const) {
            if (current.current[field] === sent[field])
              Object.assign(preserved, { [field]: acknowledged[field] });
          }
          base.current = acknowledged;
          change(preserved);
          setError(null);
          setConflict(null);
          const unchanged = !unsaved.current;
          if (unchanged) unsaved.current = false;
          if (unchanged)
            try {
              sessionStorage.removeItem(storageKey);
            } catch {
              setStorageError(true);
            }
          // Preserve list statistics/team membership and reject older acknowledgements.
          client.setQueryData<Plan[]>([kind], (old) =>
            old
              ? existing
                ? old.map((p) => (p.id === result.id ? mergeVersioned(p, result) : p))
                : [result, ...old.filter((p) => p.id !== result.id)]
              : old,
          );
          void client.invalidateQueries({ queryKey: [kind], refetchType: 'none' });
          if (!existing) {
            void navigate('/' + kind + '/' + result.id, {
              replace: true,
              // The durable page keeps the way back to the picker that started this draft.
              ...(origin.from ? { state: { from: origin.from, fromState: origin.fromState } } : {}),
            });
            break;
          }
        } catch (failure) {
          setError(errorMessage(failure));
          if (failure instanceof ApiError && failure.status === 409) {
            const server = failure.details?.current as Plan | undefined;
            if (server && typeof server.name === 'string' && Number.isSafeInteger(server.version))
              setConflict(server);
          }
          if (
            !existing &&
            failure instanceof ApiError &&
            failure.status >= 400 &&
            failure.status < 500 &&
            ![408, 409].includes(failure.status)
          )
            change({ attempt: undefined });
          requested.current = false;
          break;
        }
      } while (requested.current);
    } finally {
      lock.current = false;
      setBusy(false);
      syncClean();
    }
  }
  function applyServerVersion(server: Plan) {
    if (busy || !window.confirm('Discard these local edits and use the current server version?'))
      return;
    version.current = server.version;
    latestServer.current = server;
    base.current = planDraft(server, current.current.team);
    change({
      team: server.team_id ?? server.team_ids?.[0] ?? current.current.team,
      name: server.name,
      description: server.description ?? '',
      start: server.start_date ?? '',
      end: server.target_date ?? server.end_date ?? '',
      status: server.status ?? 'planned',
      health: server.health ?? 'on_track',
      lead: server.lead_id ?? null,
      version: server.version,
      attempt: undefined,
    });
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      setStorageError(true);
    }
    unsaved.current = false;
    setConflict(null);
    setError(null);
  }
  function property(patch: Partial<Draft>) {
    change(patch);
    if (existing) void save();
  }
  const frozen = readonly || (!existing && (busy || Boolean(draft.attempt)));
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      try {
        if (sessionStorage.getItem(storageKey)) {
          event.preventDefault();
          event.returnValue = '';
        }
      } catch {
        if (current.current.name) {
          event.preventDefault();
          event.returnValue = '';
        }
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [storageKey]);
  return (
    <section className="issue-detail-panel" aria-label={(existing ? '' : 'New ') + noun}>
      <header className="issue-detail-toolbar">
        <div className="breadcrumb">
          <Button
            variant="ghost"
            size="icon"
            aria-label={'Back to ' + back.label}
            onClick={() => navigate(back.to, { state: back.state })}
          >
            <ChevronLeft size={16} />
          </Button>
          {kind === 'projects' ? <Folder size={15} /> : <CalendarRange size={15} />}
          <span>{existing ? existing.name : 'New ' + noun}</span>
        </div>
        {!existing ? (
          <Button
            variant="default"
            size="sm"
            disabled={
              readonly ||
              busy ||
              !draft.name.trim() ||
              (kind === 'cycles' && (!draft.start || !draft.end))
            }
            onClick={() => void save()}
          >
            {busy ? 'Creating…' : draft.attempt ? 'Retry creation' : 'Create ' + noun}
          </Button>
        ) : (
          <span className="muted">{busy ? 'Saving…' : 'Edit in place'}</span>
        )}
      </header>
      <div className="detail-layout">
        <div className="detail-main">
          {kind === 'projects' ? (
            <DocumentText
              title={draft.name}
              titlePlaceholder="Project name"
              titleMaxLength={200}
              onEditStart={() => {
                editing.current = true;
              }}
              onEditEnd={() => {
                editing.current = false;
                syncClean();
              }}
              description={draft.description}
              onChange={(field, value) =>
                change({ [field === 'title' ? 'name' : 'description']: value })
              }
              onCommit={() => {
                if (existing) void save();
              }}
              readOnly={frozen}
            />
          ) : (
            <InlineTitle
              value={draft.name}
              placeholder="Cycle name"
              maxLength={200}
              onEditStart={() => {
                editing.current = true;
              }}
              onEditEnd={() => {
                editing.current = false;
                syncClean();
              }}
              onChange={(name) => change({ name })}
              onCommit={() => {
                if (existing) void save();
              }}
              readOnly={frozen}
            />
          )}
          {error && <ErrorState message={error} retry={conflict ? undefined : () => void save()} />}
          {conflict && (
            <section className="document-feedback" aria-label="Resolve conflict">
              <h3>A newer server version exists</h3>
              <p>
                Your draft is unchanged. Server version {conflict.version}:{' '}
                <strong>{conflict.name}</strong>
              </p>
              {conflict.description && (
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {conflict.description}
                </pre>
              )}
              <Button disabled={busy} onClick={() => applyServerVersion(conflict)}>
                Use server version
              </Button>
              <Button
                disabled={busy}
                variant="ghost"
                onClick={() => {
                  if (
                    !window.confirm(
                      'Replace the server fields with your local draft? Other newer edits will still cause a conflict.',
                    )
                  )
                    return;
                  version.current = conflict.version;
                  change({ version: conflict.version });
                  setConflict(null);
                  void save();
                }}
              >
                Keep my draft and retry
              </Button>
            </section>
          )}
          {storageError && (
            <ErrorState message="Browser storage is unavailable. Keep this page open until your edits are saved." />
          )}
          {!existing && (
            <p className="document-create-hint">
              Private draft. Nothing is published until you create this {noun}.
            </p>
          )}
          {existing && (
            <section className="detail-section">
              <h3>Tasks</h3>
              <Link
                className="button button-ghost"
                to={'/tasks?' + (kind === 'projects' ? 'project_id=' : 'cycle_id=') + existing.id}
              >
                View linked tasks →
              </Link>
            </section>
          )}
        </div>
        <aside className="detail-properties" aria-label={noun + ' properties'}>
          <h3>Properties</h3>
          <div className="compact-property">
            <Folder size={15} />
            <Combobox
              aria-label="Team"
              value={draft.team}
              options={catalog?.teams.map((t) => ({ value: t.id, label: t.name })) ?? []}
              onChange={(team) => property({ team })}
              disabled={frozen || Boolean(existing)}
            />
          </div>
          {kind === 'projects' && (
            <>
              <div className="compact-property">
                <Combobox
                  aria-label="Project status"
                  value={draft.status}
                  options={['planned', 'in_progress', 'paused', 'completed', 'canceled'].map(
                    (value) => ({ value, label: value.replaceAll('_', ' ') }),
                  )}
                  onChange={(status) => property({ status })}
                  disabled={frozen || busy}
                />
              </div>
              <div className="compact-property">
                <Combobox
                  aria-label="Project health"
                  value={draft.health}
                  options={['on_track', 'at_risk', 'off_track'].map((value) => ({
                    value,
                    label: value.replaceAll('_', ' '),
                  }))}
                  onChange={(health) => property({ health })}
                  disabled={frozen || busy}
                />
              </div>
              <div className="compact-property">
                <Combobox
                  aria-label="Project lead"
                  value={canonicalPersonValue(catalog, draft.lead)}
                  options={[{ value: 'none', label: 'No lead' }, ...personOptions(catalog)]}
                  onChange={(lead) => property({ lead: lead === 'none' ? null : lead })}
                  disabled={frozen || busy}
                />
              </div>
            </>
          )}
          <div className="property-section-title">Dates</div>
          <DateProperty
            label="Start date"
            value={draft.start || null}
            onChange={(value) => property({ start: value ?? '' })}
            disabled={frozen || busy}
          />
          <DateProperty
            label={kind === 'projects' ? 'Target date' : 'End date'}
            value={draft.end || null}
            onChange={(value) => property({ end: value ?? '' })}
            disabled={frozen || busy}
          />
        </aside>
      </div>
    </section>
  );
}
