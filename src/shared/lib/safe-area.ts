import { useSyncExternalStore } from 'react';

/** Gap every popup keeps from the viewport edge and from fixed chrome (docs/PHONE-OVERFLOW.md). */
const EDGE = 8;

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * The edge each popup must stay clear of, in pixels: the `env(safe-area-inset-*)` insets, and at
 * the bottom whichever is taller of that inset and `--fixed-chrome-bottom` (the phone dock, set by
 * the phone layout's CSS). Resolved on a hidden fixed element, so `env()` and `calc()` apply.
 */
function reservedEdges(): Insets {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) max(env(safe-area-inset-bottom,0px),var(--fixed-chrome-bottom,0px)) env(safe-area-inset-left,0px)';
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const edges = {
    top: parseFloat(style.paddingTop),
    right: parseFloat(style.paddingRight),
    bottom: parseFloat(style.paddingBottom),
    left: parseFloat(style.paddingLeft),
  };
  probe.remove();
  return edges;
}

let padding: Insets | undefined;
const listeners = new Set<() => void>();

/** Replaces the cached padding only when an edge changed, keeping snapshot identity stable. */
function update() {
  const edge = reservedEdges();
  const next = {
    top: EDGE + edge.top,
    right: EDGE + edge.right,
    bottom: EDGE + edge.bottom,
    left: EDGE + edge.left,
  };
  if (
    padding &&
    padding.top === next.top &&
    padding.right === next.right &&
    padding.bottom === next.bottom &&
    padding.left === next.left
  )
    return false;
  padding = next;
  return true;
}
// The collapsing address bar fires resize on every scroll; only a real change (rotation, or
// crossing into or out of the phone layout) re-renders the popups' owners.
function onResize() {
  if (update()) for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  if (!listeners.size) {
    // Edges may have changed while nothing listened; React re-reads the snapshot next.
    update();
    addEventListener('resize', onResize);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) removeEventListener('resize', onResize);
  };
}
function snapshot() {
  if (!padding) update();
  return padding!;
}

/**
 * Base UI `collisionPadding`: 8px plus each side's safe-area inset, and at the bottom 8px above
 * the phone dock, so a popup stays clear of the notch, the home indicator, landscape side insets
 * and the navigation it would otherwise run under.
 */
export function usePopupCollisionPadding(): Insets {
  return useSyncExternalStore(subscribe, snapshot);
}
