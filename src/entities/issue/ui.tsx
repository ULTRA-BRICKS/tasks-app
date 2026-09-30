import { RefreshingText } from '@/shared/ui/refreshing-text';
import type { CSSProperties, ReactNode } from 'react';
import {
  Circle,
  CheckCircle2,
  CircleDashed,
  Disc,
  MinusCircle,
  Layers,
  SignalHigh,
  SignalMedium,
  SignalLow,
  AlertTriangle,
  Minus,
} from 'lucide-react';
import type { Issue, Status, StatusCategory } from '@tickets/contracts';
import { Avatar, PressPreview, Markdown } from '@/shared/ui';
import { formatDate, isOverdue } from '@/shared/lib/date';
import { priorities, useIssue } from './model';
export function StatusIcon({
  category,
  color,
  label,
}: {
  category: StatusCategory;
  color?: string;
  label?: string;
}) {
  const Icon =
    category === 'completed'
      ? CheckCircle2
      : category === 'started'
        ? Disc
        : category === 'backlog'
          ? CircleDashed
          : category === 'canceled'
            ? MinusCircle
            : Circle;
  return (
    <Icon
      size={15}
      aria-label={label ?? category}
      className="status-icon"
      style={{ color: color ?? 'var(--color-muted)' }}
    />
  );
}
export function PriorityIcon({ value }: { value: number }) {
  const Icon = [Minus, AlertTriangle, SignalHigh, SignalMedium, SignalLow][value] ?? Minus;
  return (
    <Icon
      size={15}
      className={value === 1 ? 'priority-urgent' : 'priority-icon'}
      aria-label={priorities[value]?.label ?? 'No priority'}
    />
  );
}
export function IssueRow({
  issue,
  status,
  onOpen,
  selected,
  onSelect,
  canSelect = true,
  updating = false,
  assigneeControl,
}: {
  issue: Issue;
  status?: Status;
  onOpen: () => void;
  selected?: boolean;
  onSelect?: () => void;
  canSelect?: boolean;
  updating?: boolean;
  assigneeControl?: ReactNode;
}) {
  return (
    <PressPreview
      label={`Preview ${issue.key}`}
      dialogLabel="Task preview"
      content={<IssuePeek issue={issue} />}
      actions={[
        { label: 'Open task', run: onOpen },
        {
          label: 'Copy link',
          run: () =>
            navigator.clipboard.writeText(new URL('/tasks/' + issue.id, location.origin).href),
        },
        ...(canSelect && onSelect
          ? [{ label: selected ? 'Deselect task' : 'Select task', run: onSelect }]
          : []),
      ]}
    >
      <div
        className={'issue-row' + (selected ? ' is-selected' : '')}
        data-testid="issue-row"
        data-update-active={updating}
      >
        {canSelect && onSelect ? (
          <label className="issue-selection">
            <input
              type="checkbox"
              className="issue-checkbox"
              checked={Boolean(selected)}
              onChange={onSelect}
              aria-label={`Select ${issue.key}`}
            />
          </label>
        ) : (
          <span />
        )}
        <PriorityIcon value={issue.priority} />
        <span className="issue-key" data-selectable>
          {issue.key}
        </span>
        <button
          type="button"
          className="issue-open"
          aria-label={issue.key + ' ' + issue.title}
          onClick={() => {
            if (!window.getSelection()?.toString()) onOpen();
          }}
        >
          <StatusIcon
            category={status?.category ?? issue.status_category}
            color={status?.color ?? issue.status_color}
          />
          {issue.kind === 'epic' && <Layers size={14} />}
          <RefreshingText text={issue.title} />
        </button>
        <div className="issue-labels">
          {issue.labels.slice(0, 2).map((l) => (
            <span className="label-pill" key={l.id}>
              <i style={{ '--label-color': l.color } as CSSProperties} />
              {l.name}
            </span>
          ))}
        </div>
        <span
          className={
            'issue-date' + (isOverdue(issue.due_date, issue.status_category) ? ' overdue' : '')
          }
        >
          {issue.due_date ? formatDate(issue.due_date) : ''}
        </span>
        {assigneeControl ?? <Avatar name={issue.assignee_name} />}
      </div>
    </PressPreview>
  );
}
export function IssueCard({
  issue,
  onOpen,
  assigneeAvatarUrl,
}: {
  issue: Issue;
  onOpen: () => void;
  /** Photo of the assignee's canonical person (docs/SLACK-PROFILES.md); initials without it. */
  assigneeAvatarUrl?: string | null;
}) {
  return (
    <PressPreview
      label={`Preview ${issue.key}`}
      dialogLabel="Task preview"
      content={<IssuePeek issue={issue} />}
      actions={[
        { label: 'Open task', run: onOpen },
        {
          label: 'Copy link',
          run: () =>
            navigator.clipboard.writeText(new URL('/tasks/' + issue.id, location.origin).href),
        },
      ]}
    >
      <button
        type="button"
        className="issue-card"
        onClick={() => {
          if (!window.getSelection()?.toString()) onOpen();
        }}
      >
        <span className="card-meta">
          <span className="issue-key" data-selectable>
            {issue.key}
          </span>
          <PriorityIcon value={issue.priority} />
        </span>
        <span className="card-title" data-selectable>
          {issue.title}
        </span>
        <span className="card-footer">
          <span>{issue.labels[0]?.name ?? (issue.kind === 'epic' ? 'Epic' : 'Task')}</span>
          <Avatar name={issue.assignee_name} src={assigneeAvatarUrl} />
        </span>
      </button>
    </PressPreview>
  );
}

function IssuePeek({ issue }: { issue: Issue }) {
  const details = useIssue(issue.id);
  return (
    <>
      <span className="issue-key" data-selectable>
        {issue.key}
      </span>
      <h2 data-selectable>{issue.title}</h2>
      <p className="muted">
        {priorities[issue.priority]?.label} · {issue.assignee_name || 'Unassigned'}
      </p>
      {details.isPending ? (
        <output>Loading preview…</output>
      ) : details.error ? (
        <output>Details unavailable. You can still open the task.</output>
      ) : (
        <Markdown>{(details.data?.description || 'No description yet.').slice(0, 2000)}</Markdown>
      )}
    </>
  );
}
