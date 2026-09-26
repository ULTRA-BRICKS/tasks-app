import { useLocalState } from '../../shared/lib/state';
import { type CSSProperties } from 'react';
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
import { IssueCard, StatusIcon } from '@/entities/issue';
import { useIssueUpdate, useIssueWriteBusy } from '@/features/issue-edit';
import { ErrorState, Button } from '@/shared/ui';
import { errorMessage } from '@/shared/api/client';
function Draggable({
  issue,
  onOpen,
  disabled,
}: {
  issue: Issue;
  onOpen: () => void;
  disabled: boolean;
}) {
  const { setNodeRef, setActivatorNodeRef, isDragging, transform, listeners, attributes } =
    useDraggable({ id: issue.id, disabled });
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
      <IssueCard issue={issue} onOpen={onOpen} />
    </div>
  );
}
function Column({
  status,
  issues,
  onOpen,
  onCreate,
  disabled,
}: {
  status: Status;
  issues: Issue[];
  onOpen: (id: string) => void;
  onCreate: (status: Status) => void;
  disabled: boolean;
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
          aria-label={`Create issue in ${status.name}`}
          onClick={() => onCreate(status)}
          disabled={disabled}
        >
          <Plus size={15} />
        </Button>
      </header>
      <div className="board-cards">
        {issues.map((i) => (
          <Draggable key={i.id} issue={i} onOpen={() => onOpen(i.id)} disabled={disabled} />
        ))}
        {!issues.length && <div className="board-empty">Drop an issue here</div>}
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
}: {
  issues: Issue[];
  statuses: Status[];
  onOpen: (id: string) => void;
  onCreate: (status: Status) => void;
  readOnly: boolean;
}) {
  const [active, setActive] = useLocalState<Issue | null>(null),
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
        Drag an issue using its move handle. Keyboard: Space to pick up, arrow keys to move, Space
        to drop, Escape to cancel. You can also open an issue and choose its status.
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
            />
          ))}
        </div>
        <DragOverlay>
          {active && (
            <div className="drag-preview">
              <IssueCard issue={active} onOpen={() => {}} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </>
  );
}
