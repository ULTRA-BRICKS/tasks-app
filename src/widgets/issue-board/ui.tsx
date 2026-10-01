import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus } from 'lucide-react';
import type { Issue, Status } from '@tickets/contracts';
import { IssueCard, StatusIcon, type OpenTask } from '@/entities/issue';
import { PersonChip } from '@/entities/workspace';
import { useIssueUpdate, useIssueWriteBusy, useTaskActions } from '@/features/issue-edit';
import { ErrorState, Button } from '@/shared/ui';
import { errorMessage } from '@/shared/api/client';
/** The page's assignee control for one card (features/issue-edit IssueAssignee). */
type AssigneeControl = (issue: Issue) => ReactNode;
function Draggable({
  issue,
  onOpen,
  disabled,
  assigneeControl,
}: {
  issue: Issue;
  onOpen: OpenTask;
  disabled: boolean;
  assigneeControl?: AssigneeControl;
}) {
  const { setNodeRef, setActivatorNodeRef, isDragging, transform, listeners, attributes } =
    useDraggable({ id: issue.id, disabled });
  const actions = useTaskActions(issue, { onOpen });
  return (
    <div
      ref={setNodeRef}
      className={'draggable-card' + (isDragging ? ' dragging' : '')}
      style={{ transform: CSS.Translate.toString(transform) } as CSSProperties}
    >
      <button
        type="button"
        className="drag-handle"
        aria-label={`Move ${issue.key}`}
        ref={setActivatorNodeRef}
        {...listeners}
        {...attributes}
        disabled={disabled}
      >
        <GripVertical size={13} />
      </button>
      <IssueCard
        issue={issue}
        onOpen={onOpen}
        actions={actions}
        assigneeControl={assigneeControl?.(issue)}
        peekAssignee={
          <PersonChip id={issue.assignee_id} name={issue.assignee_name} display="name" />
        }
      />
    </div>
  );
}
function Column({
  status,
  issues,
  onOpen,
  onCreate,
  disabled,
  assigneeControl,
}: {
  status: Status;
  issues: Issue[];
  onOpen: (id: string, focus?: 'labels') => void;
  onCreate: (status: Status) => void;
  disabled: boolean;
  assigneeControl?: AssigneeControl;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id });
  return (
    <section
      ref={setNodeRef}
      className={'board-column' + (isOver ? ' drop-active' : '')}
      aria-label={status.name}
    >
      <header>
        <StatusIcon category={status.category} color={status.color} />
        <h2>{status.name}</h2>
        <span className="muted">{issues.length}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Create task in ${status.name}`}
          onClick={() => onCreate(status)}
          disabled={disabled}
        >
          <Plus size={15} />
        </Button>
      </header>
      <div className="board-cards">
        {issues.map((i) => (
          <Draggable
            key={i.id}
            issue={i}
            onOpen={(focus) => onOpen(i.id, focus)}
            disabled={disabled}
            assigneeControl={assigneeControl}
          />
        ))}
        {!issues.length && <div className="board-empty">Drop a task here</div>}
      </div>
    </section>
  );
}
export function IssueBoard({
  issues,
  statuses,
  onOpen,
  onCreate,
  readOnly,
  assigneeControl,
}: {
  issues: Issue[];
  statuses: Status[];
  onOpen: (id: string, focus?: 'labels') => void;
  onCreate: (status: Status) => void;
  readOnly: boolean;
  assigneeControl?: AssigneeControl;
}) {
  const [active, setActive] = useState<Issue | null>(null),
    mutation = useIssueUpdate(),
    busy = useIssueWriteBusy();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  function end(event: DragEndEvent) {
    setActive(null);
    const issue = issues.find((i) => i.id === event.active.id),
      status = statuses.find((s) => s.id === event.over?.id);
    if (issue && status && issue.team_id === status.team_id && issue.status_id !== status.id)
      mutation.mutate({ issue, patch: { status_id: status.id } });
  }
  return (
    <>
      {mutation.error && <ErrorState message={errorMessage(mutation.error)} />}
      <p className="sr-only">
        Drag a task using its move handle. Keyboard: Space to pick up, arrow keys to move, Space to
        drop, Escape to cancel. You can also open a task and choose its status.
      </p>
      <DndContext
        sensors={sensors}
        onDragStart={(e: DragStartEvent) =>
          setActive(issues.find((i) => i.id === e.active.id) ?? null)
        }
        onDragEnd={end}
        onDragCancel={() => setActive(null)}
      >
        <div className="board">
          {statuses.map((s) => (
            <Column
              key={s.id}
              status={s}
              issues={issues
                .filter((i) => i.status_id === s.id)
                .sort((a, b) => a.position - b.position)}
              onOpen={onOpen}
              onCreate={onCreate}
              disabled={readOnly || busy}
              assigneeControl={assigneeControl}
            />
          ))}
        </div>
        <DragOverlay>
          {active && (
            <div className="drag-preview">
              <IssueCard issue={active} onOpen={() => {}} actions={[]} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </>
  );
}
