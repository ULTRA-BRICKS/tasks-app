import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileText, Flag } from 'lucide-react';
import { api, errorMessage } from '@/shared/api/client';
import {
  ActionMenu,
  Button,
  Picker,
  ErrorState,
  Loading,
  EmptyState,
  DocumentText,
} from '@/shared/ui';
import { useCatalog, useMe, useProjects } from '@/entities/workspace';
import { useKnowledgeDraft, type Knowledge, type Kind } from './model';

const noun = (kind: Kind) => (kind === 'documents' ? 'document' : 'initiative');
export function KnowledgeListPage({ kind }: { kind: Kind }) {
  const [parameters, setParameters] = useSearchParams();
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
          {query.data.map((row) => (
            <Link key={row.id} to={'/' + kind + '/' + row.id} className="knowledge-row">
              {kind === 'documents' ? <FileText size={18} /> : <Flag size={18} />}
              <span>{row.title ?? row.name}</span>
              <small>{row.status?.replace('_', ' ') ?? 'Document'}</small>
            </Link>
          ))}
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
  if (!me || (id !== 'new' && query.isPending)) return <Loading />;
  if (query.error) return <ErrorState message={errorMessage(query.error)} />;
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
      <header className="issue-detail-toolbar">
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
        {row && !readOnly && (
          <ActionMenu
            label={noun(kind) + ' actions'}
            items={[
              {
                label: (row.archived_at ? 'Restore ' : 'Archive ') + noun(kind),
                disabled: model.dirty || model.busy,
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
            descriptionMaxLength={kind === 'documents' ? 500000 : 100000}
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
              <Picker
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
                <Picker
                  aria-label="Status"
                  value={model.draft.status}
                  disabled={disabled}
                  options={['planned', 'active', 'completed', 'canceled'].map((status) => ({
                    value: status,
                    label: status[0].toUpperCase() + status.slice(1),
                  }))}
                  onChange={(status) => property({ status })}
                />
                <Picker
                  aria-label="Owner"
                  value={model.draft.owner_id ?? 'none'}
                  disabled={disabled}
                  options={[
                    { value: 'none', label: 'No owner' },
                    ...(catalog?.people.map((person) => ({
                      value: person.id,
                      label: person.name,
                    })) ?? []),
                    ...(catalog?.source_people?.map((person) => ({
                      value: person.id,
                      label: person.name + ' · imported',
                    })) ?? []),
                  ]}
                  onChange={(value) => property({ owner_id: value === 'none' ? null : value })}
                />
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
                <Picker
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
