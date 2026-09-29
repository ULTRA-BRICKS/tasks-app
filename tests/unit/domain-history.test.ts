import { describe, expect, test } from 'bun:test';
import {
  dropHistoryStep,
  emptyHistory,
  planHistoryStep,
  recordChange,
  settleHistoryStep,
  type DomainChange,
  type DomainHistory,
  type EntitySnapshot,
} from '../../src/shared/lib/domain-history';

const change = (overrides: Partial<DomainChange> = {}): DomainChange => ({
  entityId: 'task-1',
  label: 'Change status',
  before: { status_id: 'todo' },
  after: { status_id: 'done' },
  ...overrides,
});
const lookup =
  (snapshots: Record<string, EntitySnapshot>) =>
  (id: string): EntitySnapshot | undefined =>
    snapshots[id];

describe('domain undo/redo', () => {
  test('an empty history has nothing to undo or redo', () => {
    expect(planHistoryStep(emptyHistory, 'undo', lookup({}), true)).toEqual({
      ok: false,
      reason: 'empty',
    });
    expect(planHistoryStep(emptyHistory, 'redo', lookup({}), true)).toEqual({
      ok: false,
      reason: 'empty',
    });
  });
  test('undo patches the previous values with the current server version', () => {
    const history = recordChange(emptyHistory, change());
    const plan = planHistoryStep(
      history,
      'undo',
      lookup({ 'task-1': { version: 7, status_id: 'done', title: 'A' } }),
      true,
    );
    expect(plan).toEqual({ ok: true, change: change(), patch: { status_id: 'todo' }, version: 7 });
  });
  test('a newer version that changed other fields does not block undo', () => {
    const history = recordChange(emptyHistory, change());
    const plan = planHistoryStep(
      history,
      'undo',
      lookup({ 'task-1': { version: 9, status_id: 'done', title: 'Renamed elsewhere' } }),
      true,
    );
    expect(plan).toMatchObject({ ok: true, version: 9 });
  });
  test('a newer conflicting value is never overwritten', () => {
    const history = recordChange(emptyHistory, change());
    expect(
      planHistoryStep(
        history,
        'undo',
        lookup({ 'task-1': { version: 9, status_id: 'review' } }),
        true,
      ),
    ).toEqual({ ok: false, reason: 'conflict', change: change(), fields: ['status_id'] });
  });
  test('primitive arrays compare as sets; other values compare strictly', () => {
    const labels = change({ before: { label_ids: [] }, after: { label_ids: ['b', 'a'] } });
    const history = recordChange(emptyHistory, labels);
    expect(
      planHistoryStep(
        history,
        'undo',
        lookup({ 'task-1': { version: 3, label_ids: ['a', 'b'] } }),
        true,
      ),
    ).toMatchObject({ ok: true, patch: { label_ids: [] } });
    expect(
      planHistoryStep(
        history,
        'undo',
        lookup({ 'task-1': { version: 3, label_ids: ['a'] } }),
        true,
      ),
    ).toMatchObject({ ok: false, reason: 'conflict' });
    const assignee = recordChange(
      emptyHistory,
      change({ before: { assignee_id: 'u1' }, after: { assignee_id: null } }),
    );
    expect(
      planHistoryStep(assignee, 'undo', lookup({ 'task-1': { version: 3 } }), true),
    ).toMatchObject({ ok: false, reason: 'conflict', fields: ['assignee_id'] });
  });
  test('missing entities and viewers are refused', () => {
    const history = recordChange(emptyHistory, change());
    expect(planHistoryStep(history, 'undo', lookup({}), true)).toEqual({
      ok: false,
      reason: 'missing',
      change: change(),
    });
    expect(
      planHistoryStep(
        history,
        'undo',
        lookup({ 'task-1': { version: 1, status_id: 'done' } }),
        false,
      ),
    ).toEqual({ ok: false, reason: 'forbidden' });
  });
  test('a settled undo becomes redo, which checks the undone value', () => {
    let history: DomainHistory = recordChange(emptyHistory, change());
    history = settleHistoryStep(history, 'undo');
    expect(history.undo).toEqual([]);
    expect(history.redo).toEqual([change()]);
    expect(
      planHistoryStep(
        history,
        'redo',
        lookup({ 'task-1': { version: 8, status_id: 'todo' } }),
        true,
      ),
    ).toEqual({ ok: true, change: change(), patch: { status_id: 'done' }, version: 8 });
    expect(
      planHistoryStep(
        history,
        'redo',
        lookup({ 'task-1': { version: 9, status_id: 'review' } }),
        true,
      ),
    ).toMatchObject({ ok: false, reason: 'conflict', fields: ['status_id'] });
    history = settleHistoryStep(history, 'redo');
    expect(history).toEqual({ undo: [change()], redo: [] });
  });
  test('a new change clears redo; dropping removes only the top step', () => {
    const first = change();
    const second = change({ entityId: 'task-2' });
    let history = settleHistoryStep(recordChange(emptyHistory, first), 'undo');
    history = recordChange(history, second);
    expect(history).toEqual({ undo: [second], redo: [] });
    history = recordChange(history, first);
    expect(dropHistoryStep(history, 'undo')).toEqual({ undo: [second], redo: [] });
    expect(settleHistoryStep(emptyHistory, 'undo')).toBe(emptyHistory);
  });
  test('history keeps the newest 50 changes', () => {
    let history = emptyHistory;
    for (let n = 0; n < 51; n += 1)
      history = recordChange(history, change({ entityId: `task-${n}` }));
    expect(history.undo).toHaveLength(50);
    expect(history.undo[0]?.entityId).toBe('task-1');
    expect(history.undo.at(-1)?.entityId).toBe('task-50');
  });
});
