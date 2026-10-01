import { useEffect, useId, useRef, useState, type Ref, type RefObject } from 'react';
import { Popover } from '@base-ui/react/popover';
import { ListTodo } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { PersonProfile } from '../lib/people';
import { cn } from '../lib/cn';
import { usePopupCollisionPadding } from '../lib/safe-area';
import { Avatar } from './avatar';
import { usePreviewLayer } from './press-preview';
import './person-popover.css';

const openDelay = 500,
  closeDelay = 200;
/** Where every person card sits against the element it opens from. */
const cardPlacement = {
  sideOffset: 8,
  align: 'start',
  className: 'popover-positioner',
} as const;
/**
 * `peek`: opened by mouse hover or keyboard focus; focus stays where it was and hover-out closes.
 * `pinned`: opened by a press (click, tap, Enter, Space) or entered by focus; behaves as a dialog.
 */
type Mode = 'closed' | 'peek' | 'pinned';

/** A person's avatar or name that opens their card (docs/PERSON-POPOVER.md). */
export function PersonPopover({
  profile,
  display = 'avatar',
  label,
  className,
  onViewTasks,
}: {
  profile: PersonProfile;
  /**
   * `avatar`: avatar only, named by `aria-label`; `name`: avatar and visible name; `text`: the
   * visible name alone, where an avatar would crowd a line of text (activity, previews).
   */
  display?: 'avatar' | 'name' | 'text';
  /** Visible text when it differs from the canonical name, e.g. an imported profile's own name. */
  label?: string;
  className?: string;
  /** Runs with View tasks, e.g. to close a drawer the card was opened from. */
  onViewTasks?: () => void;
}) {
  const [handle] = useState(() => Popover.createHandle()),
    triggerId = useId();
  const mode = useRef<Mode>('closed'),
    openTimer = useRef<number>(undefined),
    closeTimer = useRef<number>(undefined),
    // Kept after unmount so focus returning from a closed card is recognised.
    lastPopup = useRef<HTMLElement | null>(null),
    firstAction = useRef<HTMLAnchorElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    returnFocus = useRef(false);
  const name = label ?? profile.name;
  // Inside a task preview the card joins the preview's layer: it stacks above the preview, and
  // presses in it stay inside the preview (docs/PERSON-POPOVER.md).
  const layer = usePreviewLayer();
  const collisionPadding = usePopupCollisionPadding();
  const clearTimers = () => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  };
  const peekSoon = () => {
    clearTimers();
    openTimer.current = window.setTimeout(() => {
      if (handle.isOpen) return;
      mode.current = 'peek';
      handle.open(triggerId);
    }, openDelay);
  };
  const leave = () => {
    clearTimers();
    closeTimer.current = window.setTimeout(() => {
      if (mode.current === 'peek') handle.close();
    }, closeDelay);
  };
  useEffect(() => clearTimers, []);
  return (
    <Popover.Root
      handle={handle}
      onOpenChange={(open, details) => {
        clearTimers();
        if (details.reason === 'trigger-press' && mode.current === 'peek') {
          // Pressing a previewed card keeps it open and, from the keyboard, enters it.
          if (!open) details.cancel();
          mode.current = 'pinned';
          if (trigger.current?.matches(':focus-visible')) firstAction.current?.focus();
          return;
        }
        if (open) {
          if (details.reason !== 'imperative-action') mode.current = 'pinned';
          return;
        }
        // Focus goes back to the trigger only when the person dismissed a card they were in;
        // tabbing or clicking elsewhere keeps focus where it went.
        returnFocus.current =
          mode.current === 'pinned' &&
          (details.reason === 'escape-key' || details.reason === 'imperative-action');
        mode.current = 'closed';
      }}
    >
      <Popover.Trigger
        ref={trigger}
        id={triggerId}
        className={cn('person-trigger', display !== 'avatar' && 'person-trigger-name', className)}
        aria-label={display === 'avatar' ? name : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') peekSoon();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') leave();
        }}
        onPointerDown={() => clearTimeout(openTimer.current)}
        onFocus={(event) => {
          // Focus coming back from the card (Shift+Tab, or returned after Escape) is not a new
          // visit; previewing again would reopen what the person just closed.
          const returning =
            returnFocus.current ||
            (event.relatedTarget instanceof Node &&
              Boolean(lastPopup.current?.contains(event.relatedTarget)));
          returnFocus.current = false;
          if (!returning && event.currentTarget.matches(':focus-visible')) peekSoon();
        }}
        onBlur={() => clearTimeout(openTimer.current)}
      >
        {display !== 'text' && <Avatar name={profile.name} src={profile.avatar_url} decorative />}
        {display !== 'avatar' && <span className="person-trigger-text">{name}</span>}
      </Popover.Trigger>
      <Popover.Portal container={layer ?? undefined}>
        <Popover.Positioner {...cardPlacement} collisionPadding={collisionPadding}>
          <Popover.Popup
            ref={(element) => {
              if (element) lastPopup.current = element;
            }}
            className="person-card"
            initialFocus={(type) => {
              if (mode.current !== 'pinned') return false;
              // Touch focuses the card itself, so no virtual keyboard opens; Base UI focuses the
              // popup element with preventScroll.
              return type === 'touch' ? lastPopup.current : true;
            }}
            finalFocus={() => returnFocus.current}
            onPointerEnter={() => clearTimeout(closeTimer.current)}
            onPointerLeave={(event) => {
              if (event.pointerType === 'mouse' && mode.current === 'peek') leave();
            }}
            onFocus={() => {
              mode.current = 'pinned';
            }}
          >
            <PersonCardContent
              profile={profile}
              firstAction={firstAction}
              onViewTasks={() => {
                handle.close();
                onViewTasks?.();
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The card opened by another control, e.g. View profile in a row's assignee picker: it sits
 * against `anchor`, and focus returns to `returnFocus` when the person dismisses it.
 */
export function PersonCard({
  profile,
  open,
  onOpenChange,
  anchor,
  returnFocus,
  onViewTasks,
}: {
  profile: PersonProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: RefObject<Element | null>;
  /** The control that opened the card. */
  returnFocus: () => HTMLElement | null | undefined;
  onViewTasks?: () => void;
}) {
  const firstAction = useRef<HTMLAnchorElement>(null),
    dismissed = useRef(true);
  const collisionPadding = usePopupCollisionPadding();
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next, details) => {
        // As with PersonPopover: tabbing or clicking elsewhere keeps focus where it went.
        dismissed.current = details.reason === 'escape-key';
        onOpenChange(next);
      }}
    >
      <Popover.Portal>
        <Popover.Positioner anchor={anchor} {...cardPlacement} collisionPadding={collisionPadding}>
          <Popover.Popup
            className="person-card"
            initialFocus={firstAction}
            finalFocus={() => dismissed.current && returnFocus()}
            onKeyDown={(event) => {
              // The card has no trigger of its own to continue from: Tab and Shift+Tab leave it
              // from the control that opened it, as they would from a PersonPopover trigger.
              if (event.key !== 'Tab') return;
              returnFocus()?.focus();
              dismissed.current = false;
              onOpenChange(false);
            }}
          >
            <PersonCardContent
              profile={profile}
              firstAction={firstAction}
              onViewTasks={() => {
                dismissed.current = true;
                onOpenChange(false);
                onViewTasks?.();
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PersonCardContent({
  profile,
  firstAction,
  onViewTasks,
}: {
  profile: PersonProfile;
  firstAction: Ref<HTMLAnchorElement>;
  /** Closes the card and runs the caller's hook. */
  onViewTasks: () => void;
}) {
  return (
    <>
      <div className="person-card-header">
        <Avatar name={profile.name} src={profile.avatar_url} size="md" decorative />
        <div className="person-card-identity">
          <Popover.Title className="person-card-name">{profile.name}</Popover.Title>
          {profile.email && <p className="person-card-email">{profile.email}</p>}
        </div>
      </div>
      <dl className="person-card-facts">
        <div>
          <dt>Membership</dt>
          <dd>
            {profile.membership}
            {profile.is_viewer && ' · You'}
          </dd>
        </div>
        <div>
          <dt>Accounts</dt>
          <dd>{profile.accounts.join(' · ')}</dd>
        </div>
      </dl>
      {profile.needs_review && (
        <p className="person-card-review">
          <span className="review-badge">Needs review</span>
          Profiles with this identity were not merged automatically.
        </p>
      )}
      <Link
        ref={firstAction}
        to={profile.tasks_href}
        className="person-card-action"
        onClick={onViewTasks}
      >
        <ListTodo size={15} aria-hidden="true" />
        View tasks
      </Link>
    </>
  );
}
