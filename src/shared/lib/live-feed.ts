export type FeedItem = { id: string; version: number; status_id: string };
export type Feed<T extends FeedItem> = {
  visible: T[];
  latest: T[];
  groups: Record<string, string>;
  queue: string[];
  added: number;
  departed: string[];
  changed: string[];
  active: string | null;
};
function unique<T extends FeedItem>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const row of rows) {
    const previous = map.get(row.id);
    if (!previous || row.version >= previous.version) map.set(row.id, row);
  }
  return [...map.values()];
}
export function initialFeed<T extends FeedItem>(rows: T[]): Feed<T> {
  const visible = unique(rows);
  return {
    visible,
    latest: visible,
    groups: Object.fromEntries(visible.map((row) => [row.id, row.status_id])),
    queue: [],
    added: 0,
    departed: [],
    changed: [],
    active: null,
  };
}
export function refreshFeed<T extends FeedItem>(state: Feed<T>, rows: T[]): Feed<T> {
  const old = new Map([...state.visible, ...state.latest].map((row) => [row.id, row]));
  const latest = unique(rows).map((row) => {
    const previous = old.get(row.id);
    return previous && previous.version > row.version ? previous : row;
  });
  const incoming = new Map(latest.map((row) => [row.id, row])),
    visibleIds = new Set(state.visible.map((row) => row.id));
  const changed = state.visible
    .filter((row) => {
      const next = incoming.get(row.id);
      return next && next.version > row.version;
    })
    .map((row) => row.id);
  const queue = [...new Set([...state.queue.filter((id) => changed.includes(id)), ...changed])];
  return {
    ...state,
    latest,
    queue,
    added: latest.filter((row) => !visibleIds.has(row.id)).length,
    departed: state.visible.filter((row) => !incoming.has(row.id)).map((row) => row.id),
    changed: [...new Set([...state.changed.filter((id) => incoming.has(id)), ...changed])],
    // Same-version optimistic UI changes remain immediate; confirmed remote revisions are paced.
    visible: state.visible.map((row) => {
      const next = incoming.get(row.id);
      return next?.version === row.version ? next : row;
    }),
  };
}
export function revealNext<T extends FeedItem>(state: Feed<T>): Feed<T> {
  const [active, ...queue] = state.queue;
  if (!active) return { ...state, active: null };
  const next = state.latest.find((row) => row.id === active);
  return {
    ...state,
    queue,
    active,
    visible: state.visible.map((row) => (row.id === active && next ? next : row)),
  };
}
export function acceptFeed<T extends FeedItem>(state: Feed<T>): Feed<T> {
  return initialFeed(state.latest);
}

/** Explicit pagination is user-requested content, not an unsolicited live insertion. */
export function appendRequestedPage<T extends FeedItem>(state: Feed<T>, rows: T[]): Feed<T> {
  const known = new Set(state.visible.map((row) => row.id));
  const added = unique(rows).filter((row) => !known.has(row.id));
  if (!added.length) return state;
  return refreshFeed(
    {
      ...state,
      visible: [...state.visible, ...added],
      groups: {
        ...state.groups,
        ...Object.fromEntries(added.map((row) => [row.id, row.status_id])),
      },
    },
    state.latest,
  );
}
