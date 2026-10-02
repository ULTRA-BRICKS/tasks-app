/**
 * Undo/redo for saved domain changes, kept apart from native text undo (which stays with the
 * focused field). A step is planned against the current server snapshot and refused when a
 * newer version changed the same field; the patch carries the current version so the server's
 * 409 stays authoritative for races after planning. Spec: docs/KEYBOARD-COMMANDS.md.
 */
export type FieldValues = Readonly<Record<string, unknown>>;
/** `V` narrows the recorded fields for one entity type, so a planned patch keeps its types. */
export type DomainChange<V extends FieldValues = FieldValues> = {
  readonly entityId: string;
  readonly label: string;
  readonly before: V;
  readonly after: V;
};
export type DomainHistory<V extends FieldValues = FieldValues> = {
  readonly undo: readonly DomainChange<V>[];
  readonly redo: readonly DomainChange<V>[];
};
export type EntitySnapshot = { readonly version: number } & FieldValues;
export type HistoryDirection = 'undo' | 'redo';
export type HistoryPlan<V extends FieldValues = FieldValues> =
  | { ok: true; change: DomainChange<V>; patch: V; version: number }
  | { ok: false; reason: 'empty' | 'forbidden' }
  | { ok: false; reason: 'missing'; change: DomainChange<V> }
  | { ok: false; reason: 'conflict'; change: DomainChange<V>; fields: string[] };

export const historyLimit = 50;
export const emptyHistory: DomainHistory = { undo: [], redo: [] };

/** A newly saved change starts a new branch of history, so redo is cleared. */
export function recordChange<V extends FieldValues>(
  history: DomainHistory<V>,
  change: DomainChange<V>,
): DomainHistory<V> {
  return { undo: [...history.undo, change].slice(-historyLimit), redo: [] };
}

/** Code-unit order, the same order a bare `sort()` uses, made explicit. */
const codeUnitOrder = (a: unknown, b: unknown) => {
  const left = String(a),
    right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
};

/** Primitive arrays (label ids) compare as sets because the server may reorder them. */
export function sameFieldValue(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return Object.is(a, b);
  const left = [...a].sort(codeUnitOrder),
    right = [...b].sort(codeUnitOrder);
  return (
    left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  );
}

export function planHistoryStep<V extends FieldValues>(
  history: DomainHistory<V>,
  direction: HistoryDirection,
  lookup: (entityId: string) => EntitySnapshot | undefined,
  canEdit: boolean,
): HistoryPlan<V> {
  const change = history[direction].at(-1);
  if (!change) return { ok: false, reason: 'empty' };
  if (!canEdit) return { ok: false, reason: 'forbidden' };
  const current = lookup(change.entityId);
  if (!current) return { ok: false, reason: 'missing', change };
  const [expected, patch] =
    direction === 'undo' ? [change.after, change.before] : [change.before, change.after];
  const fields = Object.keys(expected).filter(
    (field) => !sameFieldValue(current[field], expected[field]),
  );
  return fields.length
    ? { ok: false, reason: 'conflict', change, fields }
    : { ok: true, change, patch, version: current.version };
}

/** After the PATCH succeeds, the step moves to the opposite stack. */
export function settleHistoryStep<V extends FieldValues>(
  history: DomainHistory<V>,
  direction: HistoryDirection,
): DomainHistory<V> {
  const change = history[direction].at(-1);
  if (!change) return history;
  return direction === 'undo'
    ? { undo: history.undo.slice(0, -1), redo: [...history.redo, change] }
    : { undo: [...history.undo, change], redo: history.redo.slice(0, -1) };
}

/** Discards a step that can no longer apply (conflict or deleted entity). */
export function dropHistoryStep<V extends FieldValues>(
  history: DomainHistory<V>,
  direction: HistoryDirection,
): DomainHistory<V> {
  if (!history[direction].length) return history;
  return direction === 'undo'
    ? { ...history, undo: history.undo.slice(0, -1) }
    : { ...history, redo: history.redo.slice(0, -1) };
}
