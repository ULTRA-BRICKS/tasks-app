import { describe, expect, test } from 'bun:test';
import {
  emptySelection,
  extendSelection,
  toggleSelection,
  type RangeSelection,
} from '../../src/shared/lib/selection-range';

const rows = ['a', 'b', 'c', 'd', 'e'];
const picked = (state: RangeSelection) => [...state.selected].sort();

describe('range selection', () => {
  test('Shift-click selects an inclusive forward and reverse range', () => {
    const forward = extendSelection(toggleSelection(emptySelection, 'b'), 'd', rows);
    expect(picked(forward)).toEqual(['b', 'c', 'd']);
    const reverse = extendSelection(toggleSelection(emptySelection, 'd'), 'b', rows);
    expect(picked(reverse)).toEqual(['b', 'c', 'd']);
    expect(reverse.anchor).toBe('d');
  });
  test('extending again shrinks, grows and flips around the same anchor', () => {
    let state = extendSelection(toggleSelection(emptySelection, 'c'), 'e', rows);
    expect(picked(state)).toEqual(['c', 'd', 'e']);
    state = extendSelection(state, 'd', rows);
    expect(picked(state)).toEqual(['c', 'd']);
    state = extendSelection(state, 'a', rows);
    expect(picked(state)).toEqual(['a', 'b', 'c']);
  });
  test('selections made before the range survive range changes', () => {
    let state = toggleSelection(toggleSelection(emptySelection, 'a'), 'd');
    state = extendSelection(state, 'e', rows);
    expect(picked(state)).toEqual(['a', 'd', 'e']);
    state = extendSelection(state, 'b', rows);
    expect(picked(state)).toEqual(['a', 'b', 'c', 'd']);
  });
  test('a plain toggle starts a new anchor and ends the previous range', () => {
    let state = extendSelection(toggleSelection(emptySelection, 'a'), 'b', rows);
    state = toggleSelection(state, 'd');
    state = extendSelection(state, 'e', rows);
    expect(picked(state)).toEqual(['a', 'b', 'd', 'e']);
    expect(picked(toggleSelection(state, 'b'))).toEqual(['a', 'd', 'e']);
  });
  test('hidden rows between anchor and target are never selected', () => {
    const visible = ['a', 'c', 'e'];
    const state = extendSelection(toggleSelection(emptySelection, 'a'), 'e', visible);
    expect(picked(state)).toEqual(['a', 'c', 'e']);
  });
  test('a filtered-out anchor makes the target the new anchor', () => {
    const start = toggleSelection(emptySelection, 'b');
    const state = extendSelection(start, 'd', ['a', 'c', 'd']);
    expect(state.anchor).toBe('d');
    expect(state.selected.has('d')).toBe(true);
    expect(picked(extendSelection(state, 'a', ['a', 'c', 'd']))).toEqual(['a', 'b', 'c', 'd']);
  });
  test('keyboard extension starts from the focused row when there is no anchor', () => {
    let state = extendSelection(emptySelection, 'c', rows, 'b');
    expect(picked(state)).toEqual(['b', 'c']);
    expect(state.anchor).toBe('b');
    state = extendSelection(state, 'd', rows, 'c');
    expect(picked(state)).toEqual(['b', 'c', 'd']);
    const noOrigin = extendSelection(emptySelection, 'c', rows);
    expect(picked(noOrigin)).toEqual(['c']);
    expect(noOrigin.anchor).toBe('c');
  });
  test('an invisible target leaves the selection unchanged', () => {
    const state = toggleSelection(emptySelection, 'a');
    expect(extendSelection(state, 'z', rows)).toBe(state);
  });
});
