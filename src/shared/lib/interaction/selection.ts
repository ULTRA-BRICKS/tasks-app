export type RangeSelection = {
  ids: Set<string>;
  anchor: string | null;
  base?: Set<string>;
  selecting?: boolean;
};
export function selectRange(
  state: RangeSelection,
  visible: readonly string[],
  id: string,
  extend: boolean,
): RangeSelection {
  if (!visible.includes(id)) return state;
  if (!extend || !state.anchor || !visible.includes(state.anchor)) {
    const ids = new Set(state.ids),
      selecting = !ids.has(id);
    if (selecting) ids.add(id);
    else ids.delete(id);
    return { ids, anchor: id, base: new Set(ids), selecting };
  }
  const start = visible.indexOf(state.anchor),
    end = visible.indexOf(id);
  const ids = new Set(state.base ?? state.ids),
    selecting = state.selecting ?? true;
  for (const key of visible.slice(Math.min(start, end), Math.max(start, end) + 1)) {
    if (selecting) ids.add(key);
    else ids.delete(key);
  }
  return { ...state, ids };
}
export const emptySelection = (): RangeSelection => ({ ids: new Set(), anchor: null });
