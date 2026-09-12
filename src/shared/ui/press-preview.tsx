import {
  useEffect,
  useCallback,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Ellipsis, X } from 'lucide-react';

type PreviewAction = { label: string; run: () => void | Promise<void> };
const selectedText = () => Boolean(window.getSelection()?.toString());
const textTarget = (target: Element) =>
  target.closest(
    '[data-selectable], input, textarea, select, [contenteditable="true"], a, .drag-handle',
  );

/** Hold on the action affordance/row whitespace; text keeps its native selection gesture. */
export function PressPreview({
  children,
  content,
  actions,
  label,
  dialogLabel = 'Preview',
}: {
  children: ReactNode;
  content: ReactNode;
  actions: PreviewAction[];
  label: string;
  dialogLabel?: string;
}) {
  const anchor = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDialogElement>(null),
    sourcePosition = useRef<{ left: number; top: number } | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [highlighted, setHighlighted] = useState(-1),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const opened = useRef(false),
    held = useRef(false),
    busy = useRef(false),
    suppressUntil = useRef(0);
  const stopTracking = useRef<() => void>(() => {}),
    hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const close = useCallback((restoreFocus = false) => {
    opened.current = false;
    held.current = false;
    stopTracking.current();
    clearTimeout(hoverTimer.current);
    setPosition(null);
    setHighlighted(-1);
    setError('');
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }, []);
  const focusAction = () =>
    requestAnimationFrame(() =>
      popup.current
        ?.querySelector<HTMLButtonElement>('[data-peek-action]')
        ?.focus({ preventScroll: true }),
    );
  const show = (focus: boolean) => {
    if (selectedText() || !anchor.current) return;
    const rect = trigger.current?.getBoundingClientRect() ?? anchor.current.getBoundingClientRect();
    document.dispatchEvent(new CustomEvent('tickets:preview-open', { detail: anchor.current }));
    sourcePosition.current = { left: rect.left, top: rect.top };
    opened.current = true;
    setError('');
    setPosition({
      left: Math.max(12, Math.min(rect.right - 344, innerWidth - 356)),
      top: Math.max(12, Math.min(rect.bottom + 8, innerHeight - 390)),
    });
    if (focus) focusAction();
  };
  const activate = async (index: number) => {
    const action = actions[index];
    if (!action || busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      await action.run();
      close();
    } catch {
      setError('Action could not be confirmed. Check the result before retrying.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const actionAt = (x: number, y: number) => {
    const button = document
      .elementFromPoint(x, y)
      ?.closest<HTMLButtonElement>('[data-peek-action]');
    return button && popup.current?.contains(button) ? Number(button.dataset.peekAction) : -1;
  };
  function start(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target as Element;
    if (popup.current?.contains(target)) return;
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      textTarget(target) ||
      selectedText() ||
      target.closest('button:not([data-peek-trigger]):not(.issue-card):not(.issue-open)')
    )
      return;
    stopTracking.current();
    clearTimeout(hoverTimer.current);
    const { pointerId, clientX: x, clientY: y } = event;
    const control = target.closest<HTMLButtonElement>('[data-peek-trigger]');
    let shown = false;
    const timer = setTimeout(() => {
      if (selectedText()) {
        cleanup();
        return;
      }
      shown = true;
      held.current = true;
      suppressUntil.current = Date.now() + 800;
      show(false);
    }, 340);
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('scroll', cancel, true);
      document.removeEventListener('selectionchange', selectionChanged);
      if (control?.hasPointerCapture(pointerId)) control.releasePointerCapture(pointerId);
      stopTracking.current = () => {};
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (!shown && Math.hypot(e.clientX - x, e.clientY - y) > 10) {
        suppressUntil.current = Date.now() + 500;
        cleanup();
        return;
      }
      if (shown) {
        e.preventDefault();
        setHighlighted(actionAt(e.clientX, e.clientY));
      }
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      cleanup();
      held.current = false;
      if (!shown) return;
      suppressUntil.current = Date.now() + 500;
      const index = actionAt(e.clientX, e.clientY);
      if (index >= 0) {
        e.preventDefault();
        void activate(index);
      } else if (
        Math.hypot(e.clientX - x, e.clientY - y) > 14 &&
        !popup.current?.contains(document.elementFromPoint(e.clientX, e.clientY))
      )
        close();
      else focusAction();
    };
    const cancel = () => {
      cleanup();
      if (shown) close();
    };
    const selectionChanged = () => {
      if (selectedText()) cancel();
    };
    stopTracking.current = cleanup;
    control?.setPointerCapture(pointerId);
    window.addEventListener('pointermove', move, { capture: true, passive: false });
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('scroll', cancel, true);
    document.addEventListener('selectionchange', selectionChanged);
  }
  useEffect(
    () => () => {
      stopTracking.current();
      clearTimeout(hoverTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!position) return;
    const anotherPreview = (event: Event) => {
      if ((event as CustomEvent<Element>).detail !== anchor.current) close();
    };
    const outside = (e: Event) => {
      const node = e.target as Node;
      if (!anchor.current?.contains(node) && !popup.current?.contains(node)) close();
    };
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    };
    const resized = () => close();
    const scrolled = (event: Event) => {
      if (popup.current?.contains(event.target as Node)) return;
      const before = sourcePosition.current;
      const current = trigger.current?.getBoundingClientRect();
      // Scroll events queued before opening can arrive after the popup commits.
      // Only an actual anchor displacement invalidates the current placement.
      if (
        before &&
        current &&
        (Math.abs(before.left - current.left) > 1 || Math.abs(before.top - current.top) > 1)
      )
        close();
    };
    document.addEventListener('tickets:preview-open', anotherPreview);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keyboard, true);
    window.addEventListener('resize', resized);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('blur', resized);
    return () => {
      document.removeEventListener('tickets:preview-open', anotherPreview);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', keyboard, true);
      window.removeEventListener('resize', resized);
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('blur', resized);
    };
  }, [position, close]);
  return (
    <div
      ref={anchor}
      className="peek-anchor"
      onPointerDown={start}
      onClickCapture={(e) => {
        if (Date.now() < suppressUntil.current && e.detail > 0) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onKeyDownCapture={(e) => {
        if (e.key === ' ' && (e.target as Element).closest('.issue-open, .issue-card')) {
          e.preventDefault();
          e.stopPropagation();
          show(true);
        }
      }}
      onContextMenu={(e) => {
        if (!textTarget(e.target as Element) && !selectedText()) {
          e.preventDefault();
          show(true);
        }
      }}
    >
      {children}
      <button
        ref={trigger}
        type="button"
        className="peek-trigger"
        data-peek-trigger
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={Boolean(position)}
        onClick={() => show(true)}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse' && e.buttons === 0 && !opened.current)
            hoverTimer.current = setTimeout(() => show(false), 500);
        }}
        onPointerLeave={() => clearTimeout(hoverTimer.current)}
      >
        <Ellipsis size={17} />
      </button>
      {position &&
        createPortal(
          <dialog
            open
            tabIndex={-1}
            ref={popup}
            aria-label={dialogLabel}
            aria-busy={pending}
            className="peek-surface"
            style={position}
            onKeyDown={(e) => {
              if (
                !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) ||
                (e.target as Element).closest('input,textarea,[contenteditable="true"]')
              )
                return;
              e.preventDefault();
              const buttons = Array.from(
                popup.current!.querySelectorAll<HTMLButtonElement>('[data-peek-action]'),
              );
              const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? buttons.length - 1
                    : (current + (e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
              buttons[next]?.focus();
              setHighlighted(next);
            }}
          >
            <div className="peek-heading">
              <span>{dialogLabel}</span>
              <button type="button" aria-label="Close preview" onClick={() => close(true)}>
                <X size={15} />
              </button>
            </div>
            <div className="peek-content">{content}</div>
            {error && (
              <p role="alert" className="peek-error">
                {error}
              </p>
            )}
            <div className="peek-actions">
              {actions.map((action, index) => (
                <button
                  key={action.label}
                  type="button"
                  data-peek-action={index}
                  disabled={pending}
                  className={highlighted === index ? 'is-highlighted' : ''}
                  onPointerEnter={() => setHighlighted(index)}
                  onClick={() => {
                    if (!held.current) void activate(index);
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </dialog>,
          document.body,
        )}
    </div>
  );
}
