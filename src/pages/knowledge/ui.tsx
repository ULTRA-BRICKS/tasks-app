import { personOptions, canonicalPersonValue } from '@/shared/lib/people';
import { copyActions } from '@/shared/lib/copy-formats';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Flag } from 'lucide-react';
import { api, errorMessage } from '@/shared/api/client';
import {
  ActionMenu,
  ContextRow,
  Button,
  Combobox,
  ErrorState,
  Loading,
  EmptyState,
  DocumentText,
  useDescriptionEditorReady,
} from '@/shared/ui';
import { useCatalog, useMe, useProjects, PersonChip } from '@/entities/workspace';
import { useKnowledgeDraft, setKnowledgeArchive, type Knowledge, type Kind } from './model';

const noun = (kind: Kind) => (kind === 'documents' ? 'document' : 'initiative');
export function KnowledgeListPage({ kind }: { kind: Kind }) {
  const [parameters, setParameters] = useSearchParams();
  const navigate = useNavigate(),
    client = useQueryClient();
  const archived = parameters.get('archived') === 'true';
  const query = useQuery({
    queryKey: [kind, { archived }],
    queryFn: () => api<Knowledge[]>('/v1/' + kind + (archived ? '?archived=true' : '')),
  });
  const { data: me } = useMe();
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState message={errorMessage(query.error)} />;
  return (
    <section className="knowledge-list">
      <header className="page-header">
        <h1>{kind === 'documents' ? 'Documents' : 'Initiatives'}</h1>
        <Button
          variant="ghost"
          aria-pressed={archived}
          onClick={() => setParameters(archived ? {} : { archived: 'true' })}
        >
          Show archived
        </Button>
        {me?.role !== 'viewer' && (
          <Link className="button button-default" to={'/' + kind + '/new'}>
            New {noun(kind)}
          </Link>
        )}
      </header>
      {!query.data?.length ? (
        <EmptyState
          title={'No ' + kind + ' yet'}
          description={'Create a ' + noun(kind) + ' or import it from Linear.'}
        />
      ) : (
        <div className="knowledge-rows">
          {query.data.map((row) => {
            const path = '/' + kind + '/' + row.id,
              title = row.title ?? row.name ?? noun(kind);
            return (
              <ContextRow
                className="knowledge-context-row"
                key={row.id}
                label={'Actions for ' + title}
                items={[
                  {
                    label: 'Open ' + noun(kind),
                    onSelect: () => {
                      void navigate(path);
                    },
                  },
                  ...copyActions({
                    title,
                    body: row.body ?? row.description,
                    path,
                    kind: noun(kind),
                  }),
                  {
                    label: (row.archived_at ? 'Restore ' : 'Archive ') + noun(kind),
                    disabled: me?.role === 'viewer',
                    separatorBefore: true,
                    onSelect: async () => {
                      if (
                        !window.confirm((row.archived_at ? 'Restore ' : 'Archive ') + title + '?')
                      )
                        return;
                      await setKnowledgeArchive(kind, row.id, row.version, !row.archived_at);
                      await client.invalidateQueries({ queryKey: [kind] });
                    },
                  },
                ]}
              >
                <Link to={path} className="knowledge-row">
                  {kind === 'documents' ? <FileText size={18} /> : <Flag size={18} />}
                  <span>{title}</span>
                  <small>{row.status?.replace('_', ' ') ?? 'Document'}</small>
                </Link>
              </ContextRow>
            );
          })}
        </div>
      )}
    </section>
  );
}
export function KnowledgePage({ kind }: { kind: Kind }) {
  const { id } = useParams(),
    { data: me } = useMe();
  const query = useQuery({
    queryKey: [kind, id],
    queryFn: () => api<Knowledge>('/v1/' + kind + '/' + id),
    enabled: id !== 'new',
  });
  // The properties sit below the body: reveal the document with its editor. An error has no
  // body to lay out, so it shows without waiting for the editor.
  const editorReady = useDescriptionEditorReady();
  if (!me || (id !== 'new' && query.isPending)) return <Loading />;
  if (query.error) return <ErrorState message={errorMessage(query.error)} />;
  if (!editorReady) return <Loading />;
  return (
    <KnowledgeEditor
      key={me.workspace_id + ':' + me.id + ':' + kind + ':' + id}
      kind={kind}
      row={query.data}
    />
  );
}
function KnowledgeEditor({ kind, row }: { kind: Kind; row?: Knowledge }) {
  const { data: me } = useMe(),
    { data: catalog } = useCatalog(),
    projects = useProjects();
  const key = [
    'input-draft',
    me?.workspace_id,
    me?.id,
    'knowledge:' + kind + ':' + (row?.id ?? 'new'),
  ]
    .map((value) => encodeURIComponent(value ?? ''))
    .join(':');
  const model = useKnowledgeDraft(kind, key, row),
    readOnly = me?.role === 'viewer';
  const disabled =
    readOnly || model.archiving || (!row && (model.busy || Boolean(model.draft.attempt)));
  const property = (patch: Parameters<typeof model.change>[0]) => {
    model.change(patch);
    if (row) void model.save();
  };
  return (
    <section className="issue-detail-panel" aria-label={(row ? '' : 'New ') + noun(kind)}>
      <header className="issue-detail-toolbar" data-page-header>
        <Link className="button button-ghost" to={'/' + kind}>
          Back to {kind}
        </Link>
        <span className="knowledge-editor-label">
          {row ? 'Edit ' + noun(kind) : 'New ' + noun(kind)}
        </span>
        {!row && (
          <Button
            variant="default"
            disabled={readOnly || model.archiving || model.busy || !model.draft.title.trim()}
            onClick={() => void model.save()}
          >
            {model.draft.attempt ? 'Retry creating' : 'Create'} {noun(kind)}
          </Button>
        )}
        {row && (
          <output aria-live="polite">
            {model.busy ? 'Saving…' : model.dirty ? 'Unsaved changes' : 'Saved'}
          </output>
        )}
        {row && (
          <ActionMenu
            label={noun(kind) + ' actions'}
            items={[
              ...copyActions({
                title: model.draft.title,
                body: model.draft.body,
                path: '/' + kind + '/' + row.id,
                kind: noun(kind),
              }),
              {
                label: (row.archived_at ? 'Restore ' : 'Archive ') + noun(kind),
                disabled: readOnly || model.dirty || model.busy || model.archiving,
                onSelect: () => void model.archive(!row.archived_at),
              },
            ]}
          />
        )}
      </header>
      <div className="issue-detail-scroll">
        <div className="knowledge-document">
          {model.error && <ErrorState message={model.error} />}
          {model.storageError && (
            <ErrorState message="Local storage could not retain a copy. Keep this tab open and copy your text before leaving." />
          )}
          {model.conflict && (
            <section className="draft-banner">
              <details>
                <summary>Review the server version</summary>
                <pre>
                  {model.conflict.title ?? model.conflict.name}
                  {'\n\n'}
                  {model.conflict.body ?? model.conflict.description}
                </pre>
              </details>
              <Button disabled={readOnly || model.busy} onClick={model.retryConflict}>
                Keep my text and retry
              </Button>
              <Button disabled={readOnly || model.busy} onClick={model.useServer}>
                Use server version
              </Button>
            </section>
          )}
          {model.error && !model.conflict && row && (
            <Button disabled={readOnly || model.busy} onClick={() => void model.save()}>
              Retry save
            </Button>
          )}
          <DocumentText
            title={model.draft.title}
            description={model.draft.body}
            titleMaxLength={kind === 'documents' ? 300 : 200}
            titlePlaceholder={'Untitled ' + noun(kind)}
            readOnly={disabled}
            onChange={(field, value) =>
              model.change(field === 'title' ? { title: value } : { body: value })
            }
            onCommit={() => {
              if (row && !readOnly) void model.save();
            }}
            onEditStart={model.beginEdit}
            onEditEnd={model.endEdit}
          />
          <div className="knowledge-properties">
            {kind === 'documents' ? (
              <Combobox
                aria-label="Project"
                value={model.draft.project_id ?? 'none'}
                disabled={disabled}
                options={[
                  { value: 'none', label: 'No project' },
                  ...(projects.data?.map((project) => ({
                    value: project.id,
                    label: project.name,
                  })) ?? []),
                ]}
                onChange={(value) => property({ project_id: value === 'none' ? null : value })}
              />
            ) : (
              <>
                <Combobox
                  aria-label="Status"
                  value={model.draft.status}
                  disabled={disabled}
                  options={['planned', 'active', 'completed', 'canceled'].map((status) => ({
                    value: status,
                    label: status[0].toUpperCase() + status.slice(1),
                  }))}
                  onChange={(status) => property({ status })}
                />
                <span className="knowledge-person">
                  {model.draft.owner_id && (
                    // The owner's avatar opens their card; the picker stays the value editor.
                    <PersonChip id={model.draft.owner_id} />
                  )}
                  <Combobox
                    aria-label="Owner"
                    value={canonicalPersonValue(catalog, model.draft.owner_id)}
                    disabled={disabled}
                    options={[{ value: 'none', label: 'No owner' }, ...personOptions(catalog)]}
                    onChange={(value) => property({ owner_id: value === 'none' ? null : value })}
                  />
                </span>
              </>
            )}
          </div>
          {kind === 'initiatives' && (
            <section aria-label="Initiative projects" className="knowledge-properties">
              {model.draft.project_ids.map((projectId) => (
                <span className="knowledge-project" key={projectId}>
                  <Link to={'/projects/' + projectId}>
                    {projects.data?.find((project) => project.id === projectId)?.name ?? 'Project'}
                  </Link>
                  {!readOnly && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={
                        'Unlink ' +
                        (projects.data?.find((project) => project.id === projectId)?.name ??
                          'project')
                      }
                      onClick={() =>
                        property({
                          project_ids: model.draft.project_ids.filter((id) => id !== projectId),
                        })
                      }
                    >
                      ×
                    </Button>
                  )}
                </span>
              ))}
              {!readOnly && (
                <Combobox
                  aria-label="Link project"
                  value="none"
                  disabled={disabled}
                  options={[
                    { value: 'none', label: 'Link a project' },
                    ...(projects.data
                      ?.filter((project) => !model.draft.project_ids.includes(project.id))
                      .map((project) => ({ value: project.id, label: project.name })) ?? []),
                  ]}
                  onChange={(id) => {
                    if (id !== 'none') property({ project_ids: [...model.draft.project_ids, id] });
                  }}
                />
              )}
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
