export type HistoryEntry = { label: string; undo: () => Promise<void>; redo: () => Promise<void> };
let past: HistoryEntry[] = [],
  future: HistoryEntry[] = [],
  busy = false,
  error = '',
  scope = '';
let snapshot = { undo: '', redo: '', busy: false, error: '' };
const listeners = new Set<() => void>();
function notify() {
  snapshot = { undo: past.at(-1)?.label ?? '', redo: future.at(-1)?.label ?? '', busy, error };
  for (const fn of listeners) fn();
}
export const actionHistory = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  snapshot: () => snapshot,
  setScope(value: string) {
    if (scope === value) return;
    scope = value;
    past = [];
    future = [];
    error = '';
    notify();
  },
  push(entry: HistoryEntry) {
    if (busy) return;
    past = [...past.slice(-49), entry];
    future = [];
    error = '';
    notify();
  },
  clearError() {
    error = '';
    notify();
  },
  async run(direction: 'undo' | 'redo') {
    if (busy) return false;
    const from = direction === 'undo' ? past : future,
      to = direction === 'undo' ? future : past;
    const entry = from.at(-1);
    if (!entry) return false;
    const owner = scope;
    busy = true;
    error = '';
    notify();
    try {
      await entry[direction]();
      if (scope === owner) {
        from.pop();
        to.push(entry);
      }
      return true;
    } catch (failure) {
      if (scope === owner)
        error = failure instanceof Error ? failure.message : 'The change could not be reversed.';
      return false;
    } finally {
      busy = false;
      notify();
    }
  },
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
type Entity = { id: string; version: number; [key: string]: unknown };
export function recordChange(
  endpoint: string,
  before: Entity,
  after: Entity,
  fields: string[],
  request: <T>(path: string, init?: { method?: string; json?: unknown }) => Promise<T>,
  refresh: () => void,
) {
  const keys = fields.filter(
    (key) =>
      !['id', 'version', 'updated_at', 'created_at'].includes(key) &&
      before[key] !== undefined &&
      after[key] !== undefined &&
      !same(before[key], after[key]),
  );
  if (!keys.length) return;
  const prior = Object.fromEntries(keys.map((key) => [key, before[key]])),
    next = Object.fromEntries(keys.map((key) => [key, after[key]]));
  async function apply(expected: Record<string, unknown>, replacement: Record<string, unknown>) {
    const current = await request<Entity>(endpoint);
    if (!keys.every((key) => same(current[key], expected[key])))
      throw new Error(
        'This content changed elsewhere. Undo was stopped so newer changes are not overwritten.',
      );
    await request(endpoint, {
      method: 'PATCH',
      json: { ...replacement, version: current.version },
    });
    refresh();
  }
  actionHistory.push({
    label: 'Change ' + keys.map((key) => key.replaceAll('_', ' ')).join(', '),
    undo: () => apply(next, prior),
    redo: () => apply(prior, next),
  });
}
