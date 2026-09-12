import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FolderKanban, CalendarRange, PanelLeft, ArrowUpRight, Flag } from 'lucide-react';
import type { Project } from '@tickets/contracts';
import { useCatalog, useProjects, useCycles, useMe, moduleEnabled } from '@/entities/workspace';
import { usePreferences } from '@/features/preferences';
import {
  Button,
  Picker,
  EmptyState,
  ErrorState,
  Loading,
  Avatar,
  PressPreview,
  Markdown,
} from '@/shared/ui';
import { api, errorMessage } from '@/shared/api/client';
import { formatDate } from '@/shared/lib/date';
export function PlanningPage({ kind }: { kind: 'projects' | 'cycles' }) {
  const { data: catalog } = useCatalog(),
    { data: me } = useMe();
  const enabled = moduleEnabled(catalog, kind === 'projects' ? 'planning' : 'cycles');
  const projects = useProjects(kind === 'projects' && enabled),
    cycles = useCycles(kind === 'cycles' && enabled),
    query = kind === 'projects' ? projects : cycles;
  const navigate = useNavigate(),
    prefs = usePreferences();
  const title = kind === 'projects' ? 'Projects' : 'Cycles',
    Icon = kind === 'projects' ? FolderKanban : CalendarRange;
  return (
    <>
      <header className="page-toolbar">
        <Button
          variant="ghost"
          size="icon"
          className="mobile-only"
          aria-label="Open navigation"
          onClick={() => prefs.setSidebarOpen(true)}
        >
          <PanelLeft size={17} />
        </Button>
        <div className="page-heading">
          <Icon size={17} />
          <h1>{title}</h1>
        </div>
        <Button
          variant="default"
          size="sm"
          disabled={me?.role === 'viewer' || !enabled}
          onClick={() => navigate('/' + kind + '/new')}
        >
          <Plus size={15} />
          New {kind === 'projects' ? 'project' : 'cycle'}
        </Button>
      </header>
      <div className="planning-content">
        {!enabled ? (
          <EmptyState
            title="Module disabled"
            description="An administrator can enable this module in Settings."
          />
        ) : query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorState message={errorMessage(query.error)} />
        ) : kind === 'projects' ? (
          projects.data?.length ? (
            <div className="project-groups">
              {(
                [
                  ['in_progress', 'In Progress'],
                  ['planned', 'Planned'],
                  ['paused', 'Paused'],
                  ['completed', 'Completed'],
                  ['canceled', 'Canceled'],
                ] as const
              ).map(([status, name]) => {
                const rows = projects.data.filter((p) => p.status === status);
                return rows.length ? (
                  <section key={status} aria-label={name} className="project-group">
                    <h2 className="project-group-heading">
                      {name}
                      <span>{rows.length}</span>
                    </h2>
                    <div className="project-grid">
                      {rows.map((project) => (
                        <ProjectCard key={project.id} project={project} />
                      ))}
                    </div>
                  </section>
                ) : null;
              })}
            </div>
          ) : (
            <EmptyState
              title="Make room for your next project"
              action={
                me?.role !== 'viewer'
                  ? { label: 'Create project', onClick: () => navigate('/' + kind + '/new') }
                  : undefined
              }
            />
          )
        ) : cycles.data?.length ? (
          <div className="cycle-list">
            {cycles.data.map((c) => (
              <Link key={c.id} className="cycle-row" to={'/cycles/' + c.id}>
                <span className="project-icon">
                  <CalendarRange size={20} />
                </span>
                <div>
                  <h3>{c.name}</h3>
                  <p>
                    {formatDate(c.start_date)} — {formatDate(c.end_date, true)}
                  </p>
                </div>
                <span className="muted">
                  {catalog?.teams.find((t) => t.id === c.team_id)?.name}
                </span>
                <ArrowUpRight size={17} />
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Plan a focused cycle"
            action={
              me?.role !== 'viewer'
                ? { label: 'Create cycle', onClick: () => navigate('/' + kind + '/new') }
                : undefined
            }
          />
        )}
      </div>
    </>
  );
}
function ProjectCard({ project }: { project: Project }) {
  const navigate = useNavigate();
  const { data: catalog } = useCatalog(),
    { data: me } = useMe(),
    client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (health: string) =>
      api<Project>('/v1/projects/' + project.id, {
        method: 'PATCH',
        json: { version: project.version, health },
      }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['projects'] });
    },
  });
  const percent = project.total ? Math.round((project.completed / project.total) * 100) : 0;
  return (
    <PressPreview
      label={`Preview ${project.name}`}
      dialogLabel="Project preview"
      content={
        <>
          <h2 data-selectable>{project.name}</h2>
          <p className="muted">
            {project.completed} / {project.total} issues · {project.health.replaceAll('_', ' ')}
          </p>
          <Markdown>{project.description || 'No description yet.'}</Markdown>
        </>
      }
      actions={[
        { label: 'Open project', run: () => navigate('/projects/' + project.id) },
        { label: 'View project issues', run: () => navigate('/issues?project_id=' + project.id) },
        {
          label: 'Copy link',
          run: () =>
            navigator.clipboard.writeText(new URL('/projects/' + project.id, location.origin).href),
        },
      ]}
    >
      <article className="project-card">
        <header>
          <span className="project-icon">
            <FolderKanban size={19} />
          </span>
          <Picker
            aria-label={`Health of ${project.name}`}
            value={project.health}
            options={[
              { value: 'on_track', label: 'On track' },
              { value: 'at_risk', label: 'At risk' },
              { value: 'off_track', label: 'Off track' },
            ]}
            onChange={(v) => mutation.mutate(v)}
            disabled={me?.role === 'viewer' || mutation.isPending}
          />
        </header>
        <Link to={'/projects/' + project.id}>
          <h3 data-selectable>{project.name}</h3>
        </Link>
        <p className="project-description">
          {project.description.replace(/[#*[\]]/g, '').slice(0, 140) ||
            'Add issues to make the next step clear.'}
        </p>
        <div className="project-progress-label">
          <span>
            {project.completed} / {project.total} issues
          </span>
          <strong>{percent}%</strong>
        </div>
        <progress max={100} value={percent} aria-label={`${project.name} completion`} />
        <footer>
          <span className="project-date">
            <Flag size={13} />
            {formatDate(project.target_date)}
          </span>
          <Avatar name={catalog?.people.find((p) => p.id === project.lead_id)?.name} />
        </footer>
        {mutation.error && <ErrorState message={errorMessage(mutation.error)} />}
      </article>
    </PressPreview>
  );
}
