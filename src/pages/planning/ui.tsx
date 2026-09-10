import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FolderKanban, CalendarRange, PanelLeft, ArrowUpRight, Flag } from 'lucide-react';
import type { Project } from '@tickets/contracts';
import { useCatalog, useProjects, useCycles, useMe, moduleEnabled } from '@/entities/workspace';
import { usePreferences } from '@/features/preferences';
import {
  Button,
  Input,
  Textarea,
  Picker,
  Modal,
  EmptyState,
  ErrorState,
  Loading,
  Avatar,
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
  const [open, setOpen] = useState(false),
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
          onClick={() => setOpen(true)}
        >
          <Plus size={15} />
          New {kind === 'projects' ? 'project' : 'cycle'}
        </Button>
      </header>
      <div className="planning-content">
        <div className="section-intro">
          <h2>
            {kind === 'projects' ? 'From intent to impact.' : 'A focused window for your team.'}
          </h2>
          <p>
            {kind === 'projects'
              ? 'A shared outcome, a clear owner, and a visible path to shipping.'
              : 'Cycles group work by time. They do not replace projects or issue relationships.'}
          </p>
        </div>
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
            <div className="project-grid">
              {projects.data.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="Make room for your next project"
              action={
                me?.role !== 'viewer'
                  ? { label: 'Create project', onClick: () => setOpen(true) }
                  : undefined
              }
            />
          )
        ) : cycles.data?.length ? (
          <div className="cycle-list">
            {cycles.data.map((c) => (
              <Link key={c.id} className="cycle-row" to={'/issues?cycle_id=' + c.id}>
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
                ? { label: 'Create cycle', onClick: () => setOpen(true) }
                : undefined
            }
          />
        )}
      </div>
      {open && <CreatePlan kind={kind} open={open} onOpenChange={setOpen} />}
    </>
  );
}
function ProjectCard({ project }: { project: Project }) {
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
      <Link to={'/issues?project_id=' + project.id}>
        <h3>{project.name}</h3>
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
  );
}
function CreatePlan({
  kind,
  open,
  onOpenChange,
}: {
  kind: 'projects' | 'cycles';
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const { data: catalog } = useCatalog(),
    client = useQueryClient();
  const [name, setName] = useState(''),
    [description, setDescription] = useState(''),
    [team, setTeam] = useState(catalog?.teams[0]?.id ?? ''),
    [start, setStart] = useState(''),
    [end, setEnd] = useState('');
  const mutation = useMutation({
    mutationFn: () =>
      api('/v1/' + kind, {
        method: 'POST',
        json:
          kind === 'projects'
            ? {
                name,
                description,
                team_ids: [team],
                start_date: start || null,
                target_date: end || null,
              }
            : { name, team_id: team, start_date: start, end_date: end },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [kind] });
      onOpenChange(false);
    },
  });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={'New ' + (kind === 'projects' ? 'project' : 'cycle')}
    >
      <form
        className="stack-form"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <label>
          Name
          <Input
            data-autofocus
            aria-label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            required
          />
        </label>
        <label>
          Team
          <Picker
            aria-label="Team"
            value={team}
            onChange={setTeam}
            options={catalog?.teams.map((t) => ({ value: t.id, label: t.name })) ?? []}
          />
        </label>
        {kind === 'projects' && (
          <label>
            Description
            <Textarea
              aria-label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        )}
        <div className="form-columns">
          <label>
            Start date
            <Input
              aria-label="Start date"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required={kind === 'cycles'}
            />
          </label>
          <label>
            {kind === 'projects' ? 'Target date' : 'End date'}
            <Input
              aria-label="End date"
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              required={kind === 'cycles'}
            />
          </label>
        </div>
        {mutation.error && <ErrorState message={errorMessage(mutation.error)} />}
        <Button
          type="submit"
          variant="default"
          disabled={!name.trim() || !team || mutation.isPending}
        >
          {mutation.isPending
            ? 'Creating…'
            : 'Create ' + (kind === 'projects' ? 'project' : 'cycle')}
        </Button>
      </form>
    </Modal>
  );
}
