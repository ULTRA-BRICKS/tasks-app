import { DateProperty } from './date-property';
import { CycleHelp } from './cycle-help';
import { useInlineCreate } from './inline-create';
import { selectedPerson, personOptions, canonicalPersonValue } from '@/shared/lib/people';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CircleDashed, Folder, Layers, Triangle, UserRound } from 'lucide-react';
import type { Catalog, IssuePatch, Milestone } from '@tickets/contracts';
import {
  useCatalog,
  useMe,
  useProjects,
  useCycles,
  useMilestones,
  moduleEnabled,
  PersonChip,
} from '@/entities/workspace';
import { StatusIcon, PriorityIcon, priorities } from '@/entities/issue';
import { Combobox, type ComboboxCreate } from '@/shared/ui';
export interface IssuePropertyValue {
  team_id: string;
  status_id: string;
  priority: number;
  assignee_id: string | null;
  project_id: string | null;
  cycle_id: string | null;
  label_ids: string[];
  estimate?: number | null;
  start_date?: string | null;
  due_date?: string | null;
  milestone_id?: string | null;
  kind?: 'issue' | 'epic';
}
export function IssueProperties({
  value: v,
  onChange,
  disabled = false,
  readOnly = false,
  onTeamChange,
}: {
  value: IssuePropertyValue;
  onChange: (patch: Omit<IssuePatch, 'version'>) => void;
  disabled?: boolean;
  readOnly?: boolean;
  onTeamChange?: (id: string) => void;
}) {
  const { data: c } = useCatalog(),
    { data: me } = useMe(),
    navigate = useNavigate(),
    location = useLocation(),
    projects = useProjects(moduleEnabled(c, 'planning')),
    cycles = useCycles(moduleEnabled(c, 'cycles')),
    milestones = useMilestones(moduleEnabled(c, 'planning'));
  const status = c?.statuses.find((s) => s.id === v.status_id),
    person = selectedPerson(c, v.assignee_id);
  // Viewers never see Create; the server still rejects their writes.
  const canCreate = !!me && me.role !== 'viewer';
  const milestoneCreate = useInlineCreate<Milestone, Milestone[]>(
    {
      noun: 'milestone',
      queryKey: ['milestones'],
      listPath: '/v1/milestones',
      rows: (data) => data?.filter((m) => m.project_id === v.project_id) ?? [],
      add: (data, row) => (data ? [...data, row] : data),
      path: '/v1/milestones',
      body: (name) => ({ project_id: v.project_id, name }),
    },
    canCreate && Boolean(v.project_id),
  );
  // Projects and cycles need more than a name: open their normal draft page instead.
  const pageFirst = (noun: 'project' | 'cycle'): ComboboxCreate | undefined =>
    canCreate
      ? {
          label: (query) => `Create ${noun} “${query}”…`,
          onCreate: (name) => {
            void navigate(`/${noun}s/new`, {
              state: {
                defaults: { name, team_id: v.team_id },
                from: `${location.pathname}${location.search}`,
                fromState: location.state,
              },
            });
          },
        }
      : undefined;
  const row = (icon: ReactNode, child: ReactNode, interactiveIcon = false) => (
    <div className="compact-property">
      <span className="property-icon" aria-hidden={interactiveIcon ? undefined : true}>
        {icon}
      </span>
      {child}
    </div>
  );
  return (
    <>
      <h3>Properties</h3>
      {onTeamChange &&
        row(
          <Layers size={15} />,
          <Combobox
            aria-label="Team"
            value={v.team_id}
            options={c?.teams.map((t) => ({ value: t.id, label: t.name })) ?? []}
            onChange={onTeamChange}
            disabled={disabled}
            readOnly={readOnly}
          />,
        )}
      {row(
        <StatusIcon category={status?.category ?? 'unstarted'} color={status?.color} />,
        <Combobox
          aria-label="Status"
          value={v.status_id}
          options={
            c?.statuses
              .filter((s) => s.team_id === v.team_id)
              .map((s) => ({ value: s.id, label: s.name })) ?? []
          }
          onChange={(id) => onChange({ status_id: id })}
          disabled={disabled}
          readOnly={readOnly}
        />,
      )}
      {row(
        <PriorityIcon value={v.priority} />,
        <Combobox
          aria-label="Priority"
          value={String(v.priority)}
          options={priorities}
          onChange={(id) => onChange({ priority: Number(id) })}
          disabled={disabled}
          readOnly={readOnly}
        />,
      )}
      {row(
        person ? <PersonChip id={person.id} /> : <UserRound size={15} />,
        <Combobox
          aria-label="Assignee"
          value={canonicalPersonValue(c, v.assignee_id)}
          options={[{ value: 'none', label: 'Unassigned' }, ...personOptions(c)]}
          onChange={(id) => onChange({ assignee_id: id === 'none' ? null : id })}
          disabled={disabled}
          readOnly={readOnly}
        />,
        Boolean(person),
      )}
      {row(
        <Triangle size={15} />,
        <Combobox
          aria-label="Estimate"
          value={v.estimate == null ? 'none' : String(v.estimate)}
          options={[
            { value: 'none', label: 'No estimate' },
            ...[
              ...new Set([0, 1, 2, 3, 5, 8, 13, 21, ...(v.estimate == null ? [] : [v.estimate])]),
            ].map((n) => ({ value: String(n), label: String(n) + ' points' })),
          ]}
          onChange={(id) => onChange({ estimate: id === 'none' ? null : Number(id) })}
          disabled={disabled}
          readOnly={readOnly}
        />,
      )}
      {moduleEnabled(c, 'cycles') &&
        row(
          <CircleDashed size={15} />,
          <>
            <Combobox
              aria-label="Cycle"
              value={v.cycle_id ?? 'none'}
              options={[
                { value: 'none', label: 'No cycle' },
                ...(cycles.data
                  ?.filter((cycle) => cycle.team_id === v.team_id)
                  .map((cycle) => ({ value: cycle.id, label: cycle.name })) ?? []),
              ]}
              onChange={(id) => onChange({ cycle_id: id === 'none' ? null : id })}
              disabled={disabled}
              readOnly={readOnly}
              create={pageFirst('cycle')}
            />
            <CycleHelp />
          </>,
        )}
      <div className="property-section-title">Labels</div>
      <LabelPicker
        selected={v.label_ids}
        disabled={disabled}
        readOnly={readOnly}
        canCreate={canCreate}
        onChange={(ids) => onChange({ label_ids: ids })}
      />
      {moduleEnabled(c, 'planning') && (
        <>
          <div className="property-section-title">Project</div>
          {row(
            <Folder size={15} />,
            <Combobox
              aria-label="Project"
              value={v.project_id ?? 'none'}
              options={[
                { value: 'none', label: 'No project' },
                ...(projects.data
                  ?.filter((p) => p.team_ids.includes(v.team_id))
                  .map((p) => ({ value: p.id, label: p.name })) ?? []),
              ]}
              onChange={(id) =>
                onChange({ project_id: id === 'none' ? null : id, milestone_id: null })
              }
              disabled={disabled}
              readOnly={readOnly}
              create={pageFirst('project')}
            />,
          )}
          {v.project_id &&
            row(
              <Layers size={15} />,
              <Combobox
                aria-label="Milestone"
                value={v.milestone_id ?? 'none'}
                options={[
                  { value: 'none', label: 'No milestone' },
                  ...(milestones.data
                    ?.filter((m) => m.project_id === v.project_id)
                    .map((m) => ({ value: m.id, label: m.name })) ?? []),
                ]}
                onChange={(id) => onChange({ milestone_id: id === 'none' ? null : id })}
                disabled={disabled}
                readOnly={readOnly}
                create={milestoneCreate}
              />,
            )}
        </>
      )}
      <div className="property-section-title">Dates</div>
      <DateProperty
        label="Start date"
        value={v.start_date ?? null}
        onChange={(value) => onChange({ start_date: value })}
        disabled={disabled}
      />
      <DateProperty
        label="Due date"
        value={v.due_date ?? null}
        onChange={(value) => onChange({ due_date: value })}
        disabled={disabled}
      />
    </>
  );
}
function LabelPicker({
  selected,
  onChange,
  disabled,
  readOnly,
  canCreate,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
  readOnly: boolean;
  canCreate: boolean;
}) {
  const { data: c } = useCatalog();
  const create = useInlineCreate<Catalog['labels'][number], Catalog>(
    {
      noun: 'label',
      queryKey: ['catalog'],
      listPath: '/v1/catalog',
      rows: (data) => data?.labels ?? [],
      add: (data, row) => (data ? { ...data, labels: [...data.labels, row] } : data),
      path: '/v1/labels',
      // Settings uses the same default colour; a stable body keeps retries identical.
      body: (name) => ({ name, color: '#a694ff' }),
    },
    canCreate,
  );
  return (
    <Combobox
      multiple
      aria-label="Labels"
      className="property-label-trigger"
      value={selected}
      onChange={onChange}
      disabled={disabled}
      readOnly={readOnly}
      options={c?.labels.map((l) => ({ value: l.id, label: l.name, color: l.color })) ?? []}
      create={create}
    />
  );
}
export { DateProperty } from './date-property';
