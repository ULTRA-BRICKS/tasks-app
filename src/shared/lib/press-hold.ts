import { useEffect, useMemo, useRef } from 'react';

/** Long-press threshold shared by previews and context rows (docs/TASK-PREVIEW.md). */
export const HOLD_DELAY = 340;
/** Movement allowed before the hold threshold; more is a scroll, drag or selection. */
const MOVE_SLOP = 10;

export const hasSelectedText = () => Boolean(window.getSelection()?.toString());

/** Targets that keep their native press gesture: text selection, editing, links and drag handles. */
export const nativePressTarget = (target: Element) =>
  target.closest(
    '[data-selectable], input, textarea, select, [contenteditable="true"], a, .drag-handle, .issue-selection',
  );

export interface HoldHandlers {
  /** Receives `data-pressing` while the hold is pending: the visible press progress. */
  surface: HTMLElement | null;
  /** Element that keeps the pointer during the hold (the preview ellipsis). */
  capture?: Element | null;
  onHold: () => void;
  /** Pointer movement after the hold fired (press–slide–release). */
  onSlide?: (event: PointerEvent) => void;
  /** Pointer release after the hold fired. */
  onRelease?: (event: PointerEvent) => void;
  /** The press was abandoned; `held` says whether the hold had already fired. */
  onCancel?: (held: boolean) => void;
}

/**
 * One press-and-hold gesture. A hold that fired or a press that was cancelled marks only
 * its own click for consumption (see useHold); a short tap passes through untouched.
 */
function trackHold(event: PointerEvent, handlers: HoldHandlers, arm: () => void) {
  const { pointerId, clientX: x, clientY: y } = event;
  const { surface, capture } = handlers;
  let held = false;
  surface?.setAttribute('data-pressing', 'true');
  const timer = setTimeout(() => {
    if (hasSelectedText()) return cancel();
    held = true;
    surface?.removeAttribute('data-pressing');
    arm();
    handlers.onHold();
  }, HOLD_DELAY);
  const stop = () => {
    clearTimeout(timer);
    surface?.removeAttribute('data-pressing');
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', release, true);
    window.removeEventListener('pointercancel', cancel, true);
    window.removeEventListener('touchmove', holdScroll, true);
    window.removeEventListener('blur', cancel);
    window.removeEventListener('scroll', scrolled, true);
    document.removeEventListener('visibilitychange', hidden);
    document.removeEventListener('selectionchange', selection);
    if (capture?.hasPointerCapture(pointerId)) capture.releasePointerCapture(pointerId);
  };
  function cancel() {
    stop();
    arm();
    handlers.onCancel?.(held);
  }
  function move(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    if (held) {
      e.preventDefault();
      handlers.onSlide?.(e);
    } else if (Math.hypot(e.clientX - x, e.clientY - y) > MOVE_SLOP) cancel();
  }
  function release(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    stop();
    if (held) handlers.onRelease?.(e);
  }
  // After the hold fires, the finger slides over the preview instead of scrolling the page.
  function holdScroll(e: TouchEvent) {
    if (held && e.cancelable) e.preventDefault();
  }
  // Scrolling before the threshold is a scroll gesture; afterwards the open surface decides.
  function scrolled() {
    if (!held) cancel();
  }
  function hidden() {
    if (document.visibilityState === 'hidden') cancel();
  }
  function selection() {
    if (hasSelectedText()) cancel();
  }
  try {
    capture?.setPointerCapture(pointerId);
  } catch {
    // Synthetic or already-released pointers cannot be captured; window listeners still track them.
  }
  window.addEventListener('pointermove', move, { capture: true, passive: false });
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', cancel, true);
  window.addEventListener('touchmove', holdScroll, { capture: true, passive: false });
  window.addEventListener('blur', cancel);
  window.addEventListener('scroll', scrolled, true);
  document.addEventListener('visibilitychange', hidden);
  document.addEventListener('selectionchange', selection);
  return stop;
}

/**
 * Press-and-hold for one surface. `pointerDown` must see every pointerdown on the surface
 * (it clears a pending click mark); `start` begins tracking a hold; `consumeClick` swallows
 * only the trusted click that belongs to the last hold or cancelled press.
 */
export function useHold() {
  const armed = useRef(false),
    stop = useRef<() => void>(() => {});
  useEffect(() => () => stop.current(), []);
  return useMemo(
    () => ({
      pointerDown() {
        armed.current = false;
      },
      start(event: PointerEvent, handlers: HoldHandlers) {
        stop.current();
        stop.current = trackHold(event, handlers, () => (armed.current = true));
      },
      cancel() {
        stop.current();
        stop.current = () => {};
      },
      consumeClick(event: MouseEvent) {
        if (!armed.current || !event.isTrusted || event.detail === 0) return false;
        armed.current = false;
        event.preventDefault();
        return true;
      },
    }),
    [],
  );
}
