/**
 * List selection with an anchor: plain toggles pick single rows, Shift-click and Shift+J/K
 * select the inclusive visible range from the anchor. Re-extending replaces only the previous
 * range, so rows picked before it survive while the range grows, shrinks or flips.
 */
export type RangeSelection = {
  readonly selected: ReadonlySet<string>;
  readonly anchor: string | null;
  /** Selection before the current range; null until a range starts from this anchor. */
  readonly base: ReadonlySet<string> | null;
};

export const emptySelection: RangeSelection = { selected: new Set(), anchor: null, base: null };

export function toggleSelection(state: RangeSelection, id: string): RangeSelection {
  const selected = new Set(state.selected);
  if (!selected.delete(id)) selected.add(id);
  return { selected, anchor: id, base: null };
}

/**
 * Selects the visible range from the anchor to `target`. A missing or filtered-out anchor falls
 * back to `origin` (the focused row, for keyboard extension); without either, the target is
 * selected and becomes the anchor. Hidden rows are never selected.
 */
export function extendSelection(
  state: RangeSelection,
  target: string,
  visibleIds: readonly string[],
  origin?: string,
): RangeSelection {
  const to = visibleIds.indexOf(target);
  if (to < 0) return state;
  const keepsAnchor = state.anchor !== null && visibleIds.includes(state.anchor);
  const anchor = keepsAnchor
    ? state.anchor
    : origin !== undefined && visibleIds.includes(origin)
      ? origin
      : null;
  if (anchor === null)
    return { selected: new Set(state.selected).add(target), anchor: target, base: null };
  const base = (keepsAnchor ? state.base : null) ?? state.selected;
  const from = visibleIds.indexOf(anchor);
  const selected = new Set(base);
  for (const id of visibleIds.slice(Math.min(from, to), Math.max(from, to) + 1)) selected.add(id);
  return { selected, anchor, base };
}
