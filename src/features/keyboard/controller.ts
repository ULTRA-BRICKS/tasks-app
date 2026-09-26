/**
 * Framework-agnostic keyboard controller (state-lib backend).
 *
 * Owns the two pieces of application state the baseline kept in React: the shortcut
 * help visibility and the "g then X" chord deadline. DOM, router and clock access
 * come in through ports, so behavior is testable without a browser and the DOM row
 * handles stay opaque (never stored as state).
 */
import { navigationChords } from '@/shared/lib/shortcuts';
import { createScope } from '@/shared/lib/state/scope';

export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}
export interface RowsPort {
  count(): number;
  activeIndex(): number;
  focusAt(index: number): void;
  toggleActive(): boolean;
}
export interface KeyboardPorts<E extends KeyEventLike = KeyEventLike> {
  now(): number;
  navigate(path: string, options?: { state: { from: string } }): void;
  location(): { pathname: string; search: string; from?: string };
  role(): string | undefined;
  openSearch(): void;
  guard(event: E): boolean;
  overlayOpen(): boolean;
  rows: RowsPort;
}
const CHORD_WINDOW_MS = 1000;
const ROW_KEYS = ['j', 'k', 'arrowdown', 'arrowup'];

export function createKeyboardController<E extends KeyEventLike = KeyEventLike>(
  ports: KeyboardPorts<E>,
) {
  const scope = createScope();
  const help = scope.value(false);
  const chordUntil = scope.value(0);
  const live = () => !scope.disposed;

  function handleSearch(event: KeyEventLike): void {
    // Deliberate exception: command search works inside editors; ordinary keys do not.
    if (event.defaultPrevented || event.isComposing || ports.overlayOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    ports.openSearch();
  }
  function handleChord(event: KeyEventLike, key: string): boolean {
    const target = navigationChords[key];
    if (chordUntil.get() > ports.now() && target) {
      event.preventDefault();
      chordUntil.set(0);
      ports.navigate(target);
      return true;
    }
    chordUntil.set(0);
    if (key !== 'g') return false;
    chordUntil.set(ports.now() + CHORD_WINDOW_MS);
    return true;
  }
  function handleRoute(event: KeyEventLike, key: string): boolean {
    const where = ports.location();
    if ((key === 'c' || key === 'v') && !event.repeat && ports.role() !== 'viewer') {
      event.preventDefault();
      ports.navigate('/issues/new', { state: { from: where.pathname + where.search } });
      return true;
    }
    if (event.key === '?') {
      event.preventDefault();
      help.set(true);
      return true;
    }
    if (event.key === 'Escape' && where.pathname.startsWith('/issues/')) {
      event.preventDefault();
      ports.navigate(where.from ?? '/issues');
      return true;
    }
    return false;
  }
  function nextRow(key: string, index: number, count: number): number {
    const forward = key === 'j' || key === 'arrowdown';
    if (index < 0) return forward ? 0 : count - 1;
    return Math.min(count - 1, Math.max(0, index + (forward ? 1 : -1)));
  }
  function handleRows(event: KeyEventLike, key: string): void {
    if (!ROW_KEYS.includes(key) && key !== 'x') return;
    const { rows } = ports;
    const count = rows.count();
    if (count && ROW_KEYS.includes(key)) {
      event.preventDefault();
      rows.focusAt(nextRow(key, rows.activeIndex(), count));
    } else if (key === 'x' && rows.toggleActive()) {
      event.preventDefault();
    }
  }
  function handle(event: E): void {
    if (!live()) return;
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === 'k') return handleSearch(event);
    if (ports.guard(event) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (handleChord(event, key) || handleRoute(event, key)) return;
    handleRows(event, key);
  }
  return {
    help,
    handle,
    setHelp: (open: boolean) => live() && help.set(open),
    reset: () => live() && chordUntil.set(0),
    dispose: () => scope.dispose(),
    scope,
  };
}
