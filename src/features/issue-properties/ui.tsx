import { CycleHelp } from './cycle-help';
import { selectedPerson, personOptions, canonicalPersonValue } from '@/shared/lib/people';
import { useState, type ReactNode } from 'react';
import { Popover } from '@base-ui/react/popover';
import {
  CalendarDays,
  CircleDashed,
  Folder,
  Layers,
  Plus,
  Triangle,
  UserRound,
} from 'lucide-react';
import type { IssuePatch } from '@tickets/contracts';
import {
  useCatalog,
  useProjects,
  useCycles,
  useMilestones,
  moduleEnabled,
} from '@/entities/workspace';
import { StatusIcon, PriorityIcon, priorities } from '@/entities/issue';
import { Picker, Input, Button, Avatar } from '@/shared/ui';
import { formatDate } from '@/shared/lib/date';
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
  onTeamChange,
}: {
  value: IssuePropertyValue;
  onChange: (patch: Omit<IssuePatch, 'version'>) => void;
  disabled?: boolean;
  onTeamChange?: (id: string) => void;
}) {
  const { data: c } = useCatalog(),
    projects = useProjects(moduleEnabled(c, 'planning')),
    cycles = useCycles(moduleEnabled(c, 'cycles')),
    milestones = useMilestones(moduleEnabled(c, 'planning'));
  const status = c?.statuses.find((s) => s.id === v.status_id),
    person = selectedPerson(c, v.assignee_id);
  const row = (icon: ReactNode, child: ReactNode) => (
    <div className="compact-property">
      <span className="property-icon" aria-hidden="true">
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
          <Picker
            aria-label="Team"
            value={v.team_id}
            options={c?.teams.map((t) => ({ value: t.id, label: t.name })) ?? []}
            onChange={onTeamChange}
            disabled={disabled}
          />,
        )}
      {row(
        <StatusIcon category={status?.category ?? 'unstarted'} color={status?.color} />,
        <Picker
          aria-label="Status"
          value={v.status_id}
          options={
            c?.statuses
              .filter((s) => s.team_id === v.team_id)
              .map((s) => ({ value: s.id, label: s.name })) ?? []
          }
          onChange={(id) => onChange({ status_id: id })}
          disabled={disabled}
        />,
      )}
      {row(
        <PriorityIcon value={v.priority} />,
        <Picker
          aria-label="Priority"
          value={String(v.priority)}
          options={priorities}
          onChange={(id) => onChange({ priority: Number(id) })}
          disabled={disabled}
        />,
      )}
      {row(
        person ? <Avatar name={person.name} src={person.avatar_url} /> : <UserRound size={15} />,
        <Picker
          aria-label="Assignee"
          value={canonicalPersonValue(c, v.assignee_id)}
          options={[{ value: 'none', label: 'Unassigned' }, ...personOptions(c)]}
          onChange={(id) => onChange({ assignee_id: id === 'none' ? null : id })}
          disabled={disabled}
        />,
      )}
      {row(
        <Triangle size={15} />,
        <Picker
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
        />,
      )}
      {moduleEnabled(c, 'cycles') &&
        row(
          <CircleDashed size={15} />,
          <>
            <Picker
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
            />
            <CycleHelp />
          </>,
        )}
      <div className="property-section-title">Labels</div>
      <LabelPicker
        selected={v.label_ids}
        disabled={disabled}
        onChange={(ids) => onChange({ label_ids: ids })}
      />
      {moduleEnabled(c, 'planning') && (
        <>
          <div className="property-section-title">Project</div>
          {row(
            <Folder size={15} />,
            <Picker
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
            />,
          )}
          {v.project_id &&
            row(
              <Layers size={15} />,
              <Picker
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
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const { data: c } = useCatalog(),
    [query, setQuery] = useState('');
  return (
    <Popover.Root>
      <Popover.Trigger
        disabled={disabled}
        aria-label="Edit labels"
        className="property-label-trigger"
      >
        {selected.length ? (
          c?.labels
            .filter((l) => selected.includes(l.id))
            .map((l) => (
              <span key={l.id} className="label-pill">
                <span style={{ color: l.color }}>●</span>
                {l.name}
              </span>
            ))
        ) : (
          <span className="muted">Add labels</span>
        )}
        <Plus size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="popover-positioner">
          <Popover.Popup className="property-popup">
            <Popover.Title>Labels</Popover.Title>
            <Input
              aria-label="Filter labels"
              placeholder="Search labels…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {c?.labels
              .filter((l) => l.name.toLowerCase().includes(query.toLowerCase()))
              .map((l) => (
                <label className="label-choice" key={l.id}>
                  <input
                    type="checkbox"
                    aria-label={l.name}
                    checked={selected.includes(l.id)}
                    disabled={disabled}
                    onChange={(e) =>
                      onChange(
                        e.target.checked
                          ? [...selected, l.id]
                          : selected.filter((id) => id !== l.id),
                      )
                    }
                  />
                  <span style={{ color: l.color }}>●</span>
                  {l.name}
                </label>
              ))}
            <Popover.Close className="button button-ghost button-sm">Done</Popover.Close>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
export function DateProperty({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(value ?? '');
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value ?? '');
        setOpen(next);
      }}
    >
      <Popover.Trigger
        className="date-property compact-property"
        aria-label={label}
        disabled={disabled}
      >
        <CalendarDays size={15} />
        <span>{value ? formatDate(value) : 'Set ' + label.toLowerCase()}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="popover-positioner">
          <Popover.Popup className="property-popup">
            <Popover.Title>{label}</Popover.Title>
            <Input
              type="date"
              aria-label={label + ' value'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="toolbar-actions">
              <Button
                size="sm"
                onClick={() => {
                  onChange(draft || null);
                  setOpen(false);
                }}
              >
                Apply
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                Clear
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
