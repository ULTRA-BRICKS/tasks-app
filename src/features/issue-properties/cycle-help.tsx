import { useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Info, Maximize2 } from 'lucide-react';
import { Button, Modal } from '@/shared/ui';
import { usePopupCollisionPadding } from '@/shared/lib/safe-area';
export function CycleHelp() {
  const [hint, setHint] = useState(false),
    [guide, setGuide] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const collisionPadding = usePopupCollisionPadding();
  const closeGuide = (open: boolean) => {
    setGuide(open);
    if (!open) requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };
  return (
    <>
      <Popover.Root open={hint} onOpenChange={setHint}>
        <Popover.Trigger
          ref={trigger}
          type="button"
          className="cycle-help-trigger"
          aria-label="About cycles"
          title="About cycles"
        >
          <Info size={16} />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            sideOffset={8}
            collisionPadding={collisionPadding}
            className="popover-positioner"
          >
            <Popover.Popup
              className="property-popup cycle-help-summary"
              finalFocus={guide ? false : trigger}
            >
              <Popover.Title>What is a cycle?</Popover.Title>
              <Popover.Description>
                A cycle is a fixed planning period for your team: the tasks you intend to focus on
                during those dates. It is optional, and is not a project or a task status.
              </Popover.Description>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setHint(false);
                  setGuide(true);
                }}
              >
                <Maximize2 size={15} />
                Read full guide
              </Button>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <Modal open={guide} onOpenChange={closeGuide} title="Cycles in Tasks" className="cycle-guide">
        <section
          className="cycle-guide-content"
          aria-label="Cycle guide"
          tabIndex={-1}
          data-autofocus
        >
          <p className="cycle-guide-lead">A shared answer to “What are we focusing on next?”</p>
          <h2>A planning window, not a deadline</h2>
          <p>
            A cycle groups tasks for one team between a start date and an end date. For example,
            your team could plan a two-week period called “October focus”. A task can stay outside a
            cycle until you are ready to plan it.
          </p>
          <h2>Cycle, project or status?</h2>
          <p>
            <strong>Project:</strong> the outcome you are working toward, such as launching a new
            editor. A project may take several planning periods.
          </p>
          <p>
            <strong>Cycle:</strong> the period in which the team plans to work on a task. Tasks from
            different projects can share a cycle.
          </p>
          <p>
            <strong>Status:</strong> what is happening to the task now, such as Backlog, In progress
            or Done. Choosing a cycle is not a completion action.
          </p>
          <h2>Use a cycle without changing the task</h2>
          <p>
            Open the Cycle field and choose a period belonging to this task’s team. Choose No cycle
            to remove that planning assignment; the task and its project remain. Use the Cycles page
            to create a period and set its dates.
          </p>
          <p>
            The task’s own start date and due date are separate fields. Choose them deliberately
            rather than treating the cycle’s end as an automatic due date.
          </p>
          <h2>Review what remains</h2>
          <p>
            At the end of a planning period, review incomplete work, update its status and decide
            what to plan next. A cycle is not a release: a deployment and the completion of a task
            are separate decisions.
          </p>
          <h2>An example</h2>
          <p>
            “Improve the mobile task page” can belong to the project “Better mobile experience”, be
            planned in “October focus”, and currently have the status In progress. Each field
            answers a different question.
          </p>
        </section>
        <div className="cycle-guide-footer">
          <Button type="button" onClick={() => closeGuide(false)}>
            Back to task
          </Button>
        </div>
      </Modal>
    </>
  );
}
