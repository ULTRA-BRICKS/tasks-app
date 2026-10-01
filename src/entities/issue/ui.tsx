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
  FolderKanban,
  Paperclip,
  CalendarDays,
} from 'lucide-react';
import type { Issue, Status, StatusCategory } from '@tickets/contracts';
import { Avatar, PressPreview, Markdown, type MenuAction } from '@/shared/ui';
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
export interface IssueRowProps {
  issue: Issue;
  status?: Status;
  onOpen: () => void;
  /** The task's shared contextual actions (features/issue-edit useTaskActions). */
  actions: MenuAction[];
  selected?: boolean;
  onSelect?: () => void;
  canSelect?: boolean;
  updating?: boolean;
  assigneeControl?: ReactNode;
  /** The assignee in the task preview while one is set, e.g. a person chip that opens their card. */
  peekAssignee?: ReactNode;
}
export function IssueRow({
  issue,
  status,
  onOpen,
  actions,
  selected,
  onSelect,
  canSelect = true,
  updating = false,
  assigneeControl,
  peekAssignee,
}: IssueRowProps) {
  return (
    <PressPreview
      label={`Preview ${issue.key}`}
      dialogLabel="Task preview"
      heading={issue.key}
      menuLabel={`Actions for ${issue.key}`}
      content={<IssuePeek issue={issue} assignee={peekAssignee} />}
      actions={actions}
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
  actions,
  assigneeControl,
  peekAssignee,
}: {
  issue: Issue;
  onOpen: () => void;
  actions: MenuAction[];
  /** Rendered beside the open button: a combobox cannot nest inside a button. */
  assigneeControl?: ReactNode;
  /** As on `IssueRow`: the assignee in the task preview while one is set. */
  peekAssignee?: ReactNode;
}) {
  return (
    <PressPreview
      label={`Preview ${issue.key}`}
      dialogLabel="Task preview"
      heading={issue.key}
      menuLabel={`Actions for ${issue.key}`}
      content={<IssuePeek issue={issue} assignee={peekAssignee} />}
      actions={actions}
    >
      <div className="issue-card">
        <button
          type="button"
          className="issue-card-open"
          aria-label={issue.key + ' ' + issue.title}
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
          </span>
        </button>
        <span className="card-assignee">
          {assigneeControl ?? <Avatar name={issue.assignee_name} />}
        </span>
      </div>
    </PressPreview>
  );
}

/** Content first: title, compact properties, the whole description and attachments. */
function IssuePeek({ issue, assignee }: { issue: Issue; assignee?: ReactNode }) {
  const details = useIssue(issue.id);
  return (
    <>
      <h2 data-selectable>{issue.title}</h2>
      <div className="peek-properties">
        <span className="peek-chip">
          <StatusIcon category={issue.status_category} color={issue.status_color} />
          {issue.status_name}
        </span>
        <span className="peek-chip">
          <PriorityIcon value={issue.priority} />
          {priorities[issue.priority]?.label}
        </span>
        <span className="peek-chip">
          {issue.assignee_id && assignee ? (
            assignee
          ) : (
            <>
              <Avatar name={issue.assignee_name} />
              {issue.assignee_name || 'Unassigned'}
            </>
          )}
        </span>
        {issue.labels.map((l) => (
          <span className="label-pill" key={l.id}>
            <i style={{ '--label-color': l.color } as CSSProperties} />
            {l.name}
          </span>
        ))}
        {issue.project_name && (
          <span className="peek-chip">
            <FolderKanban size={14} />
            {issue.project_name}
          </span>
        )}
        {issue.due_date && (
          <span
            className={
              'peek-chip' + (isOverdue(issue.due_date, issue.status_category) ? ' overdue' : '')
            }
          >
            <CalendarDays size={14} />
            {formatDate(issue.due_date)}
          </span>
        )}
      </div>
      {details.isPending ? (
        <output>Loading preview…</output>
      ) : details.error ? (
        <output>Details unavailable. You can still open the task.</output>
      ) : (
        <>
          <Markdown>{details.data.description || 'No description yet.'}</Markdown>
          {details.data.attachments.length > 0 && (
            <section className="peek-attachments" aria-label="Attachments">
              {details.data.attachments.map((a) => (
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
            </section>
          )}
        </>
      )}
    </>
  );
}
