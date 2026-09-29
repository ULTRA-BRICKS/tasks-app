import { useEffect, useState, type RefObject } from 'react';

/** Dock state rendered by Navigation. Header compaction is written to the DOM, not React state. */
export interface MobileChromeState {
  collapsed: boolean;
  keyboard: boolean;
}

// Content offsets in CSS px. The header compacts late and expands early (hysteresis), so the
// layout shift caused by its own height change cannot cross the opposite threshold.
const HEADER_COMPACT_ENTER_Y = 96;
const HEADER_COMPACT_EXIT_Y = 24;
// The dock stays expanded near the top, then follows the accumulated scroll direction.
const DOCK_COLLAPSE_MIN_Y = 72;
const DOCK_COLLAPSE_DISTANCE = 20;
const DOCK_EXPAND_DISTANCE = 12;
// A focused field plus a visual viewport this much shorter than the layout viewport means an
// open software keyboard.
const KEYBOARD_MIN_HEIGHT = 120;
const EDITABLE = 'input,textarea,select,[contenteditable="true"]';

/**
 * Owns the workspace's only scroll, focus and viewport listeners.
 *
 * Page toolbars mark themselves with `data-page-header`; a nested region whose vertical scroll
 * is the page's content scroll (the touch board) marks itself with `data-content-scroller`.
 * The measured header height is published as `--page-header-height` and the compact state as
 * `data-header-compact`, both on the root element, so toggling them never re-renders a route.
 */
export function useMobileChrome(mainRef: RefObject<HTMLElement | null>): MobileChromeState {
  const [collapsed, setCollapsed] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const main = mainRef.current;
    // Only touch phones have the dock and the tall header that compacts (same media as the CSS).
    const phone = matchMedia('(pointer: coarse) and (max-width: 767px)');
    const viewport = window.visualViewport;
    let header: HTMLElement | null = null;
    let headerHeight = 0;
    let scroller: HTMLElement | null = null;
    let compact = false;
    let previousY = 0;
    let accumulated = 0;
    let frame = 0;
    /** Publishes the header height for CSS and returns the unrounded height for scroll deltas. */
    const measureHeader = () => {
      const height = header?.getBoundingClientRect().height ?? 0;
      root.style.setProperty('--page-header-height', `${Math.ceil(height)}px`);
      return height;
    };
    // The header animates after compaction even when nothing scrolls (the board region is never
    // scroll-anchored), so each resize also refreshes the baseline the dock direction relies on.
    const sizeObserver = new ResizeObserver(() => {
      measureHeader();
      if (!frame) frame = requestAnimationFrame(onScrollFrame);
    });
    // A toolbar can appear after a loading state inside a persistent route wrapper, so watch the
    // whole subtree; the connected-header check keeps each mutation batch O(1). A changed header
    // means changed content: a scrolled board region may be gone without any scroll event.
    const connectHeader = () => {
      if (header?.isConnected) return;
      const previous = header;
      sizeObserver.disconnect();
      header = main?.querySelector<HTMLElement>('[data-page-header]') ?? null;
      if (header) sizeObserver.observe(header);
      headerHeight = measureHeader();
      if (header !== previous && !frame) frame = requestAnimationFrame(onScrollFrame);
    };
    const headerObserver = new MutationObserver(connectHeader);
    if (main) headerObserver.observe(main, { childList: true, subtree: true });

    const setCompact = (next: boolean) => {
      if (next === compact) return;
      compact = next;
      if (next) root.dataset.headerCompact = 'true';
      else delete root.dataset.headerCompact;
    };
    const updateCollapsed = (active: boolean, y: number, delta: number) => {
      if (!active || y < DOCK_COLLAPSE_MIN_Y) {
        accumulated = 0;
        setCollapsed(false);
        return;
      }
      if (Math.sign(delta) !== Math.sign(accumulated)) accumulated = 0;
      accumulated += delta;
      if (accumulated > DOCK_COLLAPSE_DISTANCE) {
        setCollapsed(true);
        accumulated = 0;
      } else if (accumulated < -DOCK_EXPAND_DISTANCE) {
        setCollapsed(false);
        accumulated = 0;
      }
    };
    const contentY = () => {
      if (scroller && !scroller.isConnected) scroller = null;
      return Math.max(0, window.scrollY) + (scroller?.scrollTop ?? 0);
    };
    const onScrollFrame = () => {
      frame = 0;
      const y = contentY();
      const height = header?.getBoundingClientRect().height ?? 0;
      // On-screen content movement is the scroll change minus the sticky header's own resize:
      // scroll anchoring compensating a shrinking header is not the user scrolling back up.
      const delta = y - previousY - (height - headerHeight);
      previousY = y;
      headerHeight = height;
      const active = phone.matches && !(document.activeElement?.matches(EDITABLE) ?? false);
      setCompact(active && y > (compact ? HEADER_COMPACT_EXIT_Y : HEADER_COMPACT_ENTER_Y));
      updateCollapsed(active, y, delta);
    };
    // Element scroll events do not bubble, but they do reach a capturing document listener,
    // which also receives the document's own scroll events. Other layouts never compact or
    // collapse chrome, so their scrolling schedules no work; a media change re-runs the frame.
    const onScroll = (event: Event) => {
      if (!phone.matches) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (!target.hasAttribute('data-content-scroller')) return;
        scroller = target;
      }
      if (!frame) frame = requestAnimationFrame(onScrollFrame);
    };
    const onFocusOrViewportChange = () => {
      const editing = document.activeElement?.matches(EDITABLE) ?? false;
      setKeyboard(
        Boolean(viewport && editing && window.innerHeight - viewport.height > KEYBOARD_MIN_HEIGHT),
      );
      if (editing) {
        setCollapsed(false);
        setCompact(false);
      } else if (!frame) frame = requestAnimationFrame(onScrollFrame);
    };
    // Scrolling outside the phone layout is not tracked, so entering it starts from the real
    // position instead of reading the untracked distance as one large scroll.
    const onPhoneChange = () => {
      previousY = contentY();
      onScrollFrame();
    };
    connectHeader();
    previousY = contentY();
    onScrollFrame();
    onFocusOrViewportChange();
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    document.addEventListener('focusin', onFocusOrViewportChange);
    document.addEventListener('focusout', onFocusOrViewportChange);
    viewport?.addEventListener('resize', onFocusOrViewportChange);
    phone.addEventListener('change', onPhoneChange);
    return () => {
      cancelAnimationFrame(frame);
      sizeObserver.disconnect();
      headerObserver.disconnect();
      root.style.removeProperty('--page-header-height');
      delete root.dataset.headerCompact;
      document.removeEventListener('scroll', onScroll, { capture: true });
      document.removeEventListener('focusin', onFocusOrViewportChange);
      document.removeEventListener('focusout', onFocusOrViewportChange);
      viewport?.removeEventListener('resize', onFocusOrViewportChange);
      phone.removeEventListener('change', onPhoneChange);
    };
  }, [mainRef]);
  return { collapsed, keyboard };
}
