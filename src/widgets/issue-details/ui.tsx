import { snapshotDraft as fromIssue, isDraftDirty } from './model';
import { useEffect, useState, useRef, type FormEvent } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  X,
  Link2,
  Copy,
  Check,
  Plus,
  Paperclip,
  Archive,
  Bell,
  BellOff,
  ExternalLink,
  ChevronLeft,
  Layers,
} from 'lucide-react';
import type { IssueDetail, IssuePatch, Issue } from '@tickets/contracts';
import { useIssue, StatusIcon, priorities } from '@/entities/issue';
import {
  useCatalog,
  useMe,
  useProjects,
  useCycles,
  useMilestones,
  moduleEnabled,
} from '@/entities/workspace';
import { useIssueUpdate, useIssueWriteBusy } from '@/features/issue-edit';
import { CreateIssue } from '@/features/issue-create';
import {
  Button,
  Input,
  Textarea,
  Picker,
  Markdown,
  Avatar,
  ErrorState,
  Loading,
  Modal,
} from '@/shared/ui';
import { api, errorMessage } from '@/shared/api/client';
import { formatDate } from '@/shared/lib/date';
export function IssueDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useIssue(id);
  return (
    <section className="issue-detail-panel" aria-label="Issue details">
      {query.isPending ? (
        <Loading label="Loading issue" />
      ) : query.error ? (
        <>
          <Button variant="ghost" onClick={onClose}>
            <ChevronLeft size={15} />
            Back to issues
          </Button>
          <ErrorState message={errorMessage(query.error)} retry={() => void query.refetch()} />
        </>
      ) : query.data ? (
        <Editor key={query.data.id} issue={query.data} onClose={onClose} />
      ) : null}
    </section>
  );
}
function Editor({ issue, onClose }: { issue: IssueDetail; onClose: () => void }) {
  const { data: catalog } = useCatalog(),
    { data: me } = useMe(),
    client = useQueryClient();
  const projects = useProjects(moduleEnabled(catalog, 'planning')),
    cycles = useCycles(moduleEnabled(catalog, 'cycles')),
    milestones = useMilestones(moduleEnabled(catalog, 'planning'));
  const draftKey = `ticket-draft:${me?.id}:${issue.workspace_id}:${issue.id}`;

  function initialDraft() {
    try {
      const raw = JSON.parse(sessionStorage.getItem(draftKey) ?? 'null');
      if (
        raw &&
        typeof raw.title === 'string' &&
        typeof raw.description === 'string' &&
        Number.isInteger(raw.version)
      )
        return {
          ...raw,
          baseTitle: typeof raw.baseTitle === 'string' ? raw.baseTitle : issue.title,
          baseDescription:
            typeof raw.baseDescription === 'string' ? raw.baseDescription : issue.description,
        } as ReturnType<typeof fromIssue>;
    } catch {}
    return fromIssue(issue);
  }
  const [draft, setDraft] = useState(initialDraft),
    [editing, setEditing] = useState(false),
    [comment, setComment] = useState(''),
    [relationOpen, setRelationOpen] = useState(false),
    [target, setTarget] = useState(''),
    [relationType, setRelationType] = useState('blocks'),
    [subissue, setSubissue] = useState(false),
    [copied, setCopied] = useState(false),
    [localError, setLocalError] = useState<string | null>(null);
  const upload = useRef<HTMLInputElement>(null),
    mutation = useIssueUpdate(),
    busy = useIssueWriteBusy(),
    readOnly = me?.role === 'viewer';
  const dirty = isDraftDirty(draft),
    propertiesDisabled = readOnly || busy || dirty;
  useEffect(() => {
    if (!dirty && draft.version !== issue.version) {
      // oxlint-disable-next-line react/set-state-in-effect -- Synchronize a clean form with the external query cache; never overwrite a local edit.
      setDraft({
        title: issue.title,
        description: issue.description,
        version: issue.version,
        baseTitle: issue.title,
        baseDescription: issue.description,
      });
      try {
        sessionStorage.removeItem(draftKey);
      } catch {}
    }
  }, [issue.version, issue.title, issue.description, draft.version, dirty, draftKey]);
  useEffect(() => {
    try {
      if (dirty) sessionStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {}
  }, [draft, draftKey, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const stop = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', stop);
    return () => window.removeEventListener('beforeunload', stop);
  }, [dirty]);
  function update(patch: Omit<IssuePatch, 'version'>) {
    setLocalError(null);
    mutation.mutate({ issue, patch });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft.title.trim() || busy) return;
    try {
      const result = await mutation.mutateAsync({
        issue: { ...issue, version: draft.version },
        patch: { title: draft.title, description: draft.description },
      });
      setDraft(fromIssue(result));
      setEditing(false);
      try {
        sessionStorage.removeItem(draftKey);
      } catch {}
    } catch {
      /* the mutation error is rendered; never replace the draft on conflict */
    }
  }
  function discard() {
    if (dirty && !window.confirm('Discard your local title and description changes?')) return;
    setDraft(fromIssue(issue));
    setEditing(false);
    try {
      sessionStorage.removeItem(draftKey);
    } catch {}
  }
  const action = useMutation({
    mutationFn: async (input: { kind: string; data?: unknown }) => {
      if (input.kind === 'comment')
        return api(`/v1/issues/${issue.id}/comments`, { method: 'POST', json: { body: comment } });
      if (input.kind === 'subscription')
        return api(`/v1/issues/${issue.id}/subscription`, {
          method: issue.subscribed ? 'DELETE' : 'POST',
        });
      if (input.kind === 'relation') {
        const other = await api<Issue>('/v1/issues/' + encodeURIComponent(target));
        return api(`/v1/issues/${issue.id}/relations`, {
          method: 'POST',
          json: { target_id: other.id, type: relationType },
        });
      }
      if (input.kind === 'unlink') return api('/v1/relations/' + input.data, { method: 'DELETE' });
      if (input.kind === 'export')
        return api(`/v1/issues/${issue.id}/export/github`, { method: 'POST' });
    },
    onSuccess: (_result, variables) => {
      void client.invalidateQueries({ queryKey: ['issue', issue.id] });
      void client.invalidateQueries({ queryKey: ['notifications'] });
      if (variables.kind === 'comment') setComment('');
      if (variables.kind === 'relation') {
        setRelationOpen(false);
        setTarget('');
      }
    },
  });
  async function attach(file: File) {
    let reservation:
      | {
          id: string;
          upload_url: string;
        }
      | undefined;
    try {
      setLocalError(null);
      if (file.size > 3 * 1024 * 1024)
        throw new Error('The first release accepts files up to 3 MiB.');
      const mime =
        file.type ||
        (/\.md$/i.test(file.name)
          ? 'text/markdown'
          : /\.txt$/i.test(file.name)
            ? 'text/plain'
            : 'application/octet-stream');
      reservation = await api(`/v1/issues/${issue.id}/attachments`, {
        method: 'POST',
        json: { filename: file.name, mime, bytes: file.size },
      });
      await api(reservation!.upload_url.replace(/^\/api/, ''), {
        method: 'PUT',
        body: file,
        headers: { 'content-type': 'application/octet-stream' },
      });
      await client.invalidateQueries({ queryKey: ['issue', issue.id] });
    } catch (e) {
      if (reservation)
        await api(`/v1/attachments/${reservation.id}`, { method: 'DELETE' }).catch(() => {});
      setLocalError(errorMessage(e));
    }
  }
  const [uploading, setUploading] = useState(false);
  const none = (label: string) => ({ value: 'none', label });
  return (
    <>
      <header className="issue-detail-toolbar">
        <div className="breadcrumb">
          <Layers size={14} />
          <span>{catalog?.teams.find((t) => t.id === issue.team_id)?.name}</span>
          <span className="muted">/</span>
          <span>{issue.key}</span>
        </div>
        <div className="toolbar-actions">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Copy issue link"
            onClick={() => {
              void navigator.clipboard
                .writeText(window.location.origin + '/issues/' + issue.id)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
                .catch(() =>
                  setLocalError('Clipboard is unavailable. Copy the address from your browser.'),
                );
            }}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </Button>
          <Button variant="ghost" size="icon" aria-label="Close issue" onClick={onClose}>
            <X size={17} />
          </Button>
        </div>
      </header>
      <div className="detail-layout">
        <div className="detail-main">
          {dirty && (
            <output className="draft-banner">
              Local draft preserved.
              {draft.version !== issue.version
                ? ' A newer server version exists. Saving will require reconciliation.'
                : ''}
              <Button size="sm" variant="ghost" onClick={discard}>
                Discard draft
              </Button>
            </output>
          )}
          <form onSubmit={save} className="issue-content-form">
            <Input
              aria-label="Title"
              className="detail-title"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              maxLength={300}
              disabled={readOnly}
              required
            />
            <div className="description-tabs">
              <button
                type="button"
                className={!editing ? 'active' : ''}
                onClick={() => setEditing(false)}
              >
                Preview
              </button>
              <button
                type="button"
                className={editing ? 'active' : ''}
                onClick={() => setEditing(true)}
                disabled={readOnly}
              >
                Markdown
              </button>
              <span>Markdown · GFM</span>
            </div>
            {editing ? (
              <Textarea
                aria-label="Description"
                className="detail-description"
                value={draft.description}
                maxLength={100000}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Add context, acceptance criteria, and links…"
              />
            ) : (
              <div className="description-preview">
                {draft.description ? (
                  <Markdown>{draft.description}</Markdown>
                ) : (
                  <button
                    type="button"
                    className="description-empty"
                    onClick={() => setEditing(true)}
                    disabled={readOnly}
                  >
                    Add a description…
                  </button>
                )}
              </div>
            )}
            {(dirty || editing) && (
              <div className="save-bar">
                <span className="muted">{dirty ? 'Unsaved changes' : 'No changes'}</span>
                <Button size="sm" type="button" variant="ghost" onClick={discard}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  type="submit"
                  disabled={!dirty || busy || !draft.title.trim()}
                >
                  {busy ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            )}
          </form>
          {mutation.error && <ErrorState message={errorMessage(mutation.error)} />}{' '}
          {localError && <ErrorState message={localError} />}
          <section className="detail-section">
            <header>
              <h3>
                Sub-issues <span>{issue.children.length}</span>
              </h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSubissue(true)}
                disabled={readOnly}
              >
                <Plus size={14} />
                Add
              </Button>
            </header>
            {issue.children.map((child) => (
              <Link to={'/issues/' + child.id} key={child.id} className="subissue-row">
                <StatusIcon
                  category={
                    catalog?.statuses.find((s) => s.id === child.status_id)?.category ?? 'unstarted'
                  }
                />
                <span className="issue-key">{child.key}</span>
                <span>{child.title}</span>
              </Link>
            ))}
            {!issue.children.length && (
              <p className="section-hint">
                Break this work into smaller, independently trackable issues.
              </p>
            )}
          </section>
          <section className="detail-section">
            <header>
              <h3>
                Relationships <span>{issue.relations.length}</span>
              </h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRelationOpen(true)}
                disabled={readOnly}
              >
                <Link2 size={14} />
                Link issue
              </Button>
            </header>
            {issue.relations.map((r) => {
              const outbound = r.source_id === issue.id,
                other = outbound ? r.target_id : r.source_id,
                label =
                  r.type === 'blocks'
                    ? outbound
                      ? 'Blocks'
                      : 'Blocked by'
                    : r.type === 'duplicates'
                      ? outbound
                        ? 'Duplicates'
                        : 'Duplicated by'
                      : 'Related to';
              return (
                <div key={r.id} className="relation-row">
                  <span className="muted">{label}</span>
                  <Link to={'/issues/' + other}>
                    {outbound ? r.target_key : r.source_key} ·{' '}
                    {outbound ? r.target_title : r.source_title}
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove relationship"
                    disabled={readOnly || action.isPending}
                    onClick={() => action.mutate({ kind: 'unlink', data: r.id })}
                  >
                    <X size={12} />
                  </Button>
                </div>
              );
            })}
          </section>
          {moduleEnabled(catalog, 'attachments') && (
            <section className="detail-section">
              <header>
                <h3>
                  Attachments <span>{issue.attachments.length}</span>
                </h3>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={readOnly || uploading}
                  onClick={() => upload.current?.click()}
                >
                  <Paperclip size={14} />
                  {uploading ? 'Uploading…' : 'Attach file'}
                </Button>
              </header>
              <input
                ref={upload}
                type="file"
                hidden
                accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.zip"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setUploading(true);
                    void attach(file).finally(() => setUploading(false));
                  }
                  e.currentTarget.value = '';
                }}
              />
              {issue.attachments.map((a) => (
                <a
                  className="attachment-row"
                  key={a.id}
                  href={`/api/v1/attachments/${a.id}/content`}
                >
                  <Paperclip size={15} />
                  <span>{a.filename}</span>
                  <span className="muted">{Math.ceil(a.bytes / 1024)} KB</span>
                </a>
              ))}
              {!issue.attachments.length && (
                <p className="section-hint">
                  Private files · PNG, JPEG, WebP, PDF, Markdown, ZIP · up to 3 MiB each
                </p>
              )}
            </section>
          )}
          {issue.links.length > 0 && (
            <section className="detail-section">
              <h3>External links</h3>
              {issue.links.map((l) => (
                <a
                  className="attachment-row"
                  key={l.id}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={14} />
                  <span>{l.title}</span>
                </a>
              ))}
            </section>
          )}
          <section className="detail-section activity-section">
            <header>
              <h3>Activity</h3>
              <Button
                variant="ghost"
                size="sm"
                disabled={action.isPending}
                onClick={() => action.mutate({ kind: 'subscription' })}
              >
                {issue.subscribed ? <BellOff size={14} /> : <Bell size={14} />}{' '}
                {issue.subscribed ? 'Unsubscribe' : 'Subscribe'}
              </Button>
            </header>
            {issue.activity
              .slice(0, 8)
              .reverse()
              .map((a) => (
                <div className="activity-event" key={a.id}>
                  <span className="activity-dot" />
                  <span>
                    <strong>{a.actor_name}</strong> {a.action}
                  </span>
                  <time dateTime={a.created_at}>{formatDate(a.created_at)}</time>
                </div>
              ))}
            {issue.comments.map((c) => (
              <article className="comment" key={c.id}>
                <header>
                  <Avatar name={c.author_name} />
                  <strong>{c.author_name}</strong>
                  <time dateTime={c.created_at}>{formatDate(c.created_at)}</time>
                </header>
                <Markdown>{c.body}</Markdown>
              </article>
            ))}
            {!readOnly && (
              <form
                className="comment-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (comment.trim()) action.mutate({ kind: 'comment' });
                }}
              >
                <Textarea
                  aria-label="Comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Leave a comment…"
                  maxLength={50000}
                />
                <div>
                  <span className="muted">Markdown supported</span>
                  <Button type="submit" size="sm" disabled={!comment.trim() || action.isPending}>
                    Comment
                  </Button>
                </div>
              </form>
            )}
            {action.error && <ErrorState message={errorMessage(action.error)} />}
          </section>
        </div>
        <aside className="detail-properties" aria-label="Issue properties">
          <h3>Properties</h3>
          {dirty && (
            <p className="section-hint">Save the description before changing properties.</p>
          )}
          <div className="property-row">
            <span>Status</span>
            <Picker
              aria-label="Status"
              value={issue.status_id}
              options={
                catalog?.statuses
                  .filter((s) => s.team_id === issue.team_id)
                  .map((s) => ({ value: s.id, label: s.name })) ?? []
              }
              onChange={(status_id) => update({ status_id })}
              disabled={propertiesDisabled}
            />
          </div>
          <div className="property-row">
            <span>Priority</span>
            <Picker
              aria-label="Priority"
              value={String(issue.priority)}
              options={priorities}
              onChange={(v) => update({ priority: Number(v) })}
              disabled={propertiesDisabled}
            />
          </div>
          <div className="property-row">
            <span>Assignee</span>
            <Picker
              aria-label="Assignee"
              value={issue.assignee_id ?? 'none'}
              options={[
                none('Unassigned'),
                ...(catalog?.people.map((p) => ({ value: p.id, label: p.name })) ?? []),
              ]}
              onChange={(v) => update({ assignee_id: v === 'none' ? null : v })}
              disabled={propertiesDisabled}
            />
          </div>
          <div className="property-row">
            <span>Estimate</span>
            <Picker
              aria-label="Estimate"
              value={issue.estimate === null ? 'none' : String(issue.estimate)}
              options={[
                none('No estimate'),
                ...[0, 1, 2, 3, 5, 8, 13, 21].map((v) => ({
                  value: String(v),
                  label: String(v) + ' points',
                })),
                ...(![0, 1, 2, 3, 5, 8, 13, 21].includes(issue.estimate ?? -1) &&
                issue.estimate !== null
                  ? [{ value: String(issue.estimate), label: String(issue.estimate) + ' points' }]
                  : []),
              ]}
              onChange={(v) => update({ estimate: v === 'none' ? null : Number(v) })}
              disabled={propertiesDisabled}
            />
          </div>
          <div className="property-row">
            <span>Start date</span>
            <Input
              aria-label="Start date"
              type="date"
              value={issue.start_date ?? ''}
              onChange={(e) => update({ start_date: e.target.value || null })}
              disabled={propertiesDisabled}
            />
          </div>
          <div className="property-row">
            <span>Due date</span>
            <Input
              aria-label="Due date"
              type="date"
              value={issue.due_date ?? ''}
              onChange={(e) => update({ due_date: e.target.value || null })}
              disabled={propertiesDisabled}
            />
          </div>
          {moduleEnabled(catalog, 'planning') && (
            <>
              <div className="property-section-title">Project</div>
              <Picker
                aria-label="Project"
                value={issue.project_id ?? 'none'}
                options={[
                  none('No project'),
                  ...(projects.data
                    ?.filter((p) => p.team_ids.includes(issue.team_id))
                    .map((p) => ({ value: p.id, label: p.name })) ?? []),
                ]}
                onChange={(v) =>
                  update({ project_id: v === 'none' ? null : v, milestone_id: null })
                }
                disabled={propertiesDisabled}
              />
              {issue.project_id && (
                <div className="property-row">
                  <span>Milestone</span>
                  <Picker
                    aria-label="Milestone"
                    value={issue.milestone_id ?? 'none'}
                    options={[
                      none('No milestone'),
                      ...(milestones.data
                        ?.filter((m) => m.project_id === issue.project_id)
                        .map((m) => ({ value: m.id, label: m.name })) ?? []),
                    ]}
                    onChange={(v) => update({ milestone_id: v === 'none' ? null : v })}
                    disabled={propertiesDisabled}
                  />
                </div>
              )}
            </>
          )}
          {moduleEnabled(catalog, 'cycles') && (
            <>
              <div className="property-section-title">Cycle</div>
              <Picker
                aria-label="Cycle"
                value={issue.cycle_id ?? 'none'}
                options={[
                  none('No cycle'),
                  ...(cycles.data
                    ?.filter((c) => c.team_id === issue.team_id)
                    .map((c) => ({ value: c.id, label: c.name })) ?? []),
                ]}
                onChange={(v) => update({ cycle_id: v === 'none' ? null : v })}
                disabled={propertiesDisabled}
              />
            </>
          )}
          <div className="property-section-title">Labels</div>
          <div className="labels-editor">
            {catalog?.labels.map((l) => (
              <label className="label-choice" key={l.id}>
                <input
                  type="checkbox"
                  checked={issue.label_ids.includes(l.id)}
                  disabled={propertiesDisabled}
                  onChange={(e) =>
                    update({
                      label_ids: e.target.checked
                        ? [...issue.label_ids, l.id]
                        : issue.label_ids.filter((id) => id !== l.id),
                    })
                  }
                />
                <span style={{ color: l.color }}>●</span>
                {l.name}
              </label>
            ))}
          </div>
          <div className="property-section-title">More</div>
          <Button
            size="sm"
            variant="ghost"
            disabled={propertiesDisabled}
            onClick={() => {
              if (
                window.confirm(
                  issue.archived_at
                    ? 'Restore this issue from the archive?'
                    : 'Archive this issue?',
                )
              )
                update({ archived: !issue.archived_at });
            }}
          >
            <Archive size={14} />
            {issue.archived_at ? 'Unarchive issue' : 'Archive issue'}
          </Button>
          {moduleEnabled(catalog, 'github') && ['owner', 'admin'].includes(me?.role ?? '') && (
            <Button
              size="sm"
              variant="ghost"
              disabled={action.isPending}
              onClick={() => {
                if (
                  window.confirm('Queue export of this issue to the configured GitHub repository?')
                )
                  action.mutate({ kind: 'export' });
              }}
            >
              <ExternalLink size={14} />
              Export to GitHub
            </Button>
          )}
          <p className="property-footnote">
            Created {formatDate(issue.created_at, true)}
            <br />
            Updated {formatDate(issue.updated_at, true)}
            <br />
            Version {issue.version}
          </p>
        </aside>
      </div>
      <Modal open={relationOpen} onOpenChange={setRelationOpen} title="Link an issue">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            action.mutate({ kind: 'relation' });
          }}
          className="stack-form"
        >
          <Picker
            aria-label="Relationship type"
            value={relationType}
            onChange={setRelationType}
            options={[
              { value: 'blocks', label: 'This issue blocks' },
              { value: 'related', label: 'Related to' },
              { value: 'duplicates', label: 'This issue duplicates' },
            ]}
          />
          <Input
            data-autofocus
            aria-label="Target issue key"
            placeholder="TKT-42"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            required
          />
          {action.error && <ErrorState message={errorMessage(action.error)} />}
          <Button variant="default" type="submit" disabled={!target.trim() || action.isPending}>
            Link issue
          </Button>
        </form>
      </Modal>
      {subissue && (
        <CreateIssue
          open={subissue}
          onOpenChange={setSubissue}
          defaults={{ team_id: issue.team_id, parent_id: issue.id, project_id: issue.project_id }}
        />
      )}
    </>
  );
}
