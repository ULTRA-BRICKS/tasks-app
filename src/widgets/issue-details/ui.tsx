import { invalidateTaskDetails } from '@/shared/lib/task-query-aliases';
import { copyActions } from '@/shared/lib/copy-formats';
import { ImportedSourceLink } from '@/shared/ui';
import { IssueProperties } from '@/features/issue-properties';
import { useState, useRef } from 'react';
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
import { useIssue, StatusIcon } from '@/entities/issue';
import { useCatalog, useMe, moduleEnabled, PersonChip } from '@/entities/workspace';
import { useIssueUpdate, useIssueWriteBusy, useInlineDocument } from '@/features/issue-edit';
import { CreateIssue } from '@/features/issue-create';
import { useVisibleError } from '@/features/saved-copy';
import {
  Button,
  ActionMenu,
  Input,
  Textarea,
  Picker,
  Markdown,
  DocumentText,
  ErrorState,
  Loading,
  Modal,
  useDescriptionEditorReady,
} from '@/shared/ui';
import { api, errorMessage } from '@/shared/api/client';
import { formatDate } from '@/shared/lib/date';
import { ActivityFeed } from './activity-feed';
export function IssueDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useIssue(id);
  const loadError = useVisibleError(query);
  // The properties and activity sit below the description: reveal the task with its editor.
  const editorReady = useDescriptionEditorReady();
  return (
    <section className="issue-detail-panel" aria-label="Task details">
      {query.isPending ? (
        <Loading label="Loading task" />
      ) : loadError ? (
        <>
          <Button variant="ghost" onClick={onClose}>
            <ChevronLeft size={15} />
            Back to tasks
          </Button>
          <ErrorState message={errorMessage(loadError)} retry={() => void query.refetch()} />
        </>
      ) : query.data && !editorReady ? (
        <Loading label="Loading task" />
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
  const draftKey = `ticket-draft:${me?.id}:${issue.workspace_id}:${issue.id}`;

  const document = useInlineDocument(issue, draftKey);
  const draft = document.draft,
    dirty = document.dirty;
  const [comment, setComment] = useState(''),
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
  const propertyLock = useRef(false);
  const [propertyPending, setPropertyPending] = useState(false);
  const propertiesDisabled = readOnly || busy || propertyPending;
  async function update(patch: Omit<IssuePatch, 'version'>) {
    if (propertiesDisabled || propertyLock.current) return;
    propertyLock.current = true;
    setPropertyPending(true);
    setLocalError(null);
    try {
      const current = await document.flush();
      if (current) await mutation.mutateAsync({ issue: current, patch });
    } catch (e) {
      setLocalError(errorMessage(e));
    } finally {
      propertyLock.current = false;
      setPropertyPending(false);
    }
  }
  function discard() {
    if (!dirty || window.confirm('Discard the local title and description edits?'))
      document.discard();
  }
  const commentRevision = useRef(0);
  const action = useMutation({
    mutationFn: async (input: { kind: string; data?: unknown; revision?: number }) => {
      if (input.kind === 'comment')
        return api(`/v1/issues/${issue.id}/comments`, {
          method: 'POST',
          json: { body: input.data },
        });
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
      void invalidateTaskDetails(client, issue.id);
      void client.invalidateQueries({ queryKey: ['notifications'] });
      if (variables.kind === 'comment' && variables.revision === commentRevision.current)
        setComment('');
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
      await invalidateTaskDetails(client, issue.id);
    } catch (e) {
      if (reservation)
        await api(`/v1/attachments/${reservation.id}`, { method: 'DELETE' }).catch(() => {});
      setLocalError(errorMessage(e));
    }
  }
  const [uploading, setUploading] = useState(false);
  return (
    <>
      <header className="issue-detail-toolbar" data-page-header>
        <div className="breadcrumb">
          <Layers size={14} />
          <span>{catalog?.teams.find((t) => t.id === issue.team_id)?.name}</span>
          <span className="muted">/</span>
          <span>{issue.key}</span>
        </div>
        <div className="toolbar-actions">
          <ActionMenu
            label="Task actions"
            items={copyActions({
              title: draft.title,
              body: draft.description,
              key: issue.key,
              path: '/tasks/' + issue.id,
              kind: issue.kind === 'epic' ? 'epic' : 'task',
            })}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Copy task link"
            onClick={() => {
              void navigator.clipboard
                .writeText(window.location.origin + '/tasks/' + issue.id)
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
          <Button variant="ghost" size="icon" aria-label="Close task" onClick={onClose}>
            <X size={17} />
          </Button>
        </div>
      </header>
      <div className="detail-layout">
        <div className="detail-main">
          <DocumentText
            title={draft.title}
            description={draft.description}
            onChange={document.change}
            onCommit={document.commit}
            onEditStart={document.beginEdit}
            onEditEnd={document.endEdit}
            readOnly={readOnly}
          />
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
          {(document.busy || document.error || document.storageError) && (
            <div className="document-feedback" aria-live="polite">
              {document.busy && <span className="muted">Saving…</span>}
              {document.error && (
                <>
                  <ErrorState message={document.error} />
                  {!document.conflict && (
                    <Button
                      disabled={readOnly || document.busy}
                      variant="ghost"
                      size="sm"
                      onClick={document.retry}
                    >
                      Retry save
                    </Button>
                  )}
                </>
              )}
              {document.storageError && (
                <ErrorState message="Browser storage is unavailable. Keep this page open until your edits are saved." />
              )}
            </div>
          )}
          {document.conflict && (
            <section className="document-feedback" aria-label="Resolve task conflict">
              <h3>A newer server version exists</h3>
              <p>
                Your draft is kept. Server version {document.conflict.version}:{' '}
                <strong>{document.conflict.title}</strong>
              </p>
              <Markdown>{document.conflict.description}</Markdown>
              <Button disabled={document.busy} onClick={discard}>
                Use server version
              </Button>
              <Button
                disabled={readOnly || document.busy}
                variant="ghost"
                onClick={() => {
                  if (
                    window.confirm(
                      'Replace the server title and description with your local draft? Newer concurrent edits will still cause a conflict.',
                    )
                  )
                    document.resolveConflict();
                }}
              >
                Keep my task draft
              </Button>
            </section>
          )}
          {(localError || mutation.error) && (
            <ErrorState message={localError || errorMessage(mutation.error)} />
          )}
          <section
            className={'detail-section' + (issue.children.length ? '' : ' empty-detail-section')}
          >
            <header>
              <h3>
                Sub-tasks <span>{issue.children.length}</span>
              </h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSubissue(true)}
                disabled={readOnly}
              >
                <Plus size={14} />
                Add sub-task
              </Button>
            </header>
            {issue.children.map((child) => (
              <Link to={'/tasks/' + child.id} key={child.id} className="subissue-row">
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
                Break this work into smaller, independently trackable tasks.
              </p>
            )}
          </section>
          <section
            className={'detail-section' + (issue.relations.length ? '' : ' empty-detail-section')}
          >
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
                Link task
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
                  <Link to={'/tasks/' + other}>
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
            <section
              className={
                'detail-section' + (issue.attachments.length ? '' : ' empty-detail-section')
              }
            >
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
                <ImportedSourceLink className="attachment-row" key={l.id} url={l.url}>
                  <ExternalLink size={14} />
                  <span>{l.title}</span>
                </ImportedSourceLink>
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
            <ActivityFeed activity={issue.activity} />
            {issue.comments.map((c) => (
              <article className="comment" key={c.id}>
                <header>
                  <PersonChip
                    id={c.author_source_id ?? c.author_id}
                    name={c.author_name}
                    display="name"
                  />
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
                  if (comment.trim())
                    action.mutate({
                      kind: 'comment',
                      data: comment,
                      revision: commentRevision.current,
                    });
                }}
              >
                <Textarea
                  aria-label="Comment"
                  value={comment}
                  onChange={(e) => {
                    commentRevision.current++;
                    setComment(e.target.value);
                  }}
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
        <aside className="detail-properties" aria-label="Task properties">
          <IssueProperties
            value={issue}
            onChange={(patch) => void update(patch)}
            disabled={propertiesDisabled}
          />
          <div className="property-section-title">More</div>
          <Button
            size="sm"
            variant="ghost"
            disabled={propertiesDisabled}
            onClick={() => {
              if (
                window.confirm(
                  issue.archived_at ? 'Restore this task from the archive?' : 'Archive this task?',
                )
              )
                void update({ archived: !issue.archived_at });
            }}
          >
            <Archive size={14} />
            {issue.archived_at ? 'Unarchive task' : 'Archive task'}
          </Button>
          {moduleEnabled(catalog, 'github') && ['owner', 'admin'].includes(me?.role ?? '') && (
            <Button
              size="sm"
              variant="ghost"
              disabled={action.isPending}
              onClick={() => {
                if (
                  window.confirm('Queue export of this task to the configured GitHub repository?')
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
      <Modal open={relationOpen} onOpenChange={setRelationOpen} title="Link a task">
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
              { value: 'blocks', label: 'This task blocks' },
              { value: 'related', label: 'Related to' },
              { value: 'duplicates', label: 'This task duplicates' },
            ]}
          />
          <Input
            data-autofocus
            aria-label="Target task key"
            placeholder="TKT-42"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            required
          />
          {action.error && <ErrorState message={errorMessage(action.error)} />}
          <Button variant="default" type="submit" disabled={!target.trim() || action.isPending}>
            Link task
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
