import type { CSSProperties } from 'react';
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
import { Avatar } from '@/shared/ui';
import { formatDate, isOverdue } from '@/shared/lib/date';
import { priorities } from './model';
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
}: {
  issue: Issue;
  status?: Status;
  onOpen: () => void;
  selected?: boolean;
  onSelect?: () => void;
  canSelect?: boolean;
}) {
  return (
    <div className={'issue-row' + (selected ? ' is-selected' : '')} data-testid="issue-row">
      {canSelect && onSelect ? (
        <input
          type="checkbox"
          className="issue-checkbox"
          checked={Boolean(selected)}
          onChange={onSelect}
          aria-label={`Select ${issue.key}`}
        />
      ) : (
        <span />
      )}
      <PriorityIcon value={issue.priority} />
      <span className="issue-key">{issue.key}</span>
      <button type="button" className="issue-open" onClick={onOpen}>
        <StatusIcon
          category={status?.category ?? issue.status_category}
          color={status?.color ?? issue.status_color}
        />
        {issue.kind === 'epic' && <Layers size={14} />}
        <span>{issue.title}</span>
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
      <Avatar name={issue.assignee_name} />
    </div>
  );
}
export function IssueCard({ issue, onOpen }: { issue: Issue; onOpen: () => void }) {
  return (
    <button type="button" className="issue-card" onClick={onOpen}>
      <span className="card-meta">
        <span className="issue-key">{issue.key}</span>
        <PriorityIcon value={issue.priority} />
      </span>
      <span className="card-title">{issue.title}</span>
      <span className="card-footer">
        <span>{issue.labels[0]?.name ?? (issue.kind === 'epic' ? 'Epic' : 'Issue')}</span>
        <Avatar name={issue.assignee_name} />
      </span>
    </button>
  );
}
