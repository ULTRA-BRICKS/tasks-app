/**
 * Framework-agnostic ownership scope over one state-lib Runtime.
 *
 * Reached at runtime only in the `state-lib` backend (see ./backend.ts); the baseline
 * build never imports it. Invariants: one Runtime per dependent graph, signals are
 * allocated outside transactions, opaque handles (DOM nodes, editors) are registered
 * as resources and never enter a signal.
 */
import { Runtime, toExternalStore } from '@ultrabricks/state-lib';

/** Property-style so consumers can pass the members around without losing `this`. */
export interface Store<T> {
  readonly getSnapshot: () => T;
  readonly subscribe: (notify: () => void) => () => void;
}
export interface ValueStore<T> extends Store<T> {
  get(): T;
  set(value: T): void;
  update(fn: (previous: T) => T): void;
}
export interface ResourceSlot<H> {
  get(): H;
}
export interface Scope {
  readonly runtime: Runtime;
  readonly disposed: boolean;
  readonly generation: number;
  value<T>(initial: T, equals?: (left: T, right: T) => boolean): ValueStore<T>;
  resource<H>(handle: H, release?: (handle: H) => void): ResourceSlot<H>;
  transact(fn: () => void): void;
  isCurrent(token: number): boolean;
  activate(): void;
  deactivate(): void;
  dispose(): void;
}

function valueStore<T>(runtime: Runtime, initial: T, equals?: (a: T, b: T) => boolean) {
  const signal = runtime.signal<T>(initial, equals);
  const external = toExternalStore(signal);
  return Object.freeze<ValueStore<T>>({
    getSnapshot: () => external.getSnapshot(),
    subscribe: (notify) => external.subscribe(notify),
    get: () => signal.get(),
    set: (value) => signal.set(value),
    update: (fn) => signal.update(fn),
  });
}

export function createScope(runtime: Runtime = new Runtime()): Scope {
  const releases: Array<() => void> = [];
  let disposed = false,
    active = false,
    generation = 0;
  const dispose = () => {
    if (disposed) return;
    runtime.dispose(); // May refuse inside a transaction: authority is revoked only afterwards.
    disposed = true;
    generation++;
    const errors: unknown[] = [];
    for (const release of releases.splice(0).reverse()) {
      try {
        release();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Scope resource cleanup failed');
  };
  return {
    runtime,
    get disposed() {
      return disposed;
    },
    get generation() {
      return generation;
    },
    value: (initial, equals) => valueStore(runtime, initial, equals),
    resource<H>(handle: H, release?: (handle: H) => void): ResourceSlot<H> {
      if (disposed) throw Error('Scope is disposed');
      let held = true;
      releases.push(() => {
        held = false;
        release?.(handle);
      });
      return {
        get() {
          if (!held) throw Error('Resource was released with its scope');
          return handle;
        },
      };
    },
    transact: (fn) => runtime.transaction(fn),
    isCurrent: (token) => !disposed && generation === token,
    activate() {
      if (disposed) throw Error('Scope is disposed');
      if (!active) {
        active = true;
        generation++;
      }
    },
    // Revoke async authority now; dispose in a microtask so a StrictMode replay can reactivate.
    deactivate() {
      if (disposed || !active) return;
      active = false;
      generation++;
      const token = generation;
      queueMicrotask(() => {
        if (!active && generation === token) dispose();
      });
    },
    dispose,
  };
}
