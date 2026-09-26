/**
 * Optional React bindings over the framework-agnostic scope/store core.
 * SSR-safe (server snapshot supplied) and StrictMode-safe (scope created in a lazy
 * state initializer; authority revoked on cleanup and restored on replay).
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { selectExternalStore } from '@ultrabricks/state-lib';
import type { Scope, Store } from './scope';

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useSelector<T, S>(
  store: Store<T>,
  selector: (snapshot: T) => S,
  equal?: (left: S, right: S) => boolean,
): S {
  // A selector/source change belongs to the current render, not only the first mount.
  const view = useMemo(() => {
    const selected = selectExternalStore(store, selector, equal);
    return {
      getSnapshot: () => selected.getSnapshot(),
      subscribe: (notify: () => void) => selected.subscribe(notify),
    };
  }, [store, selector, equal]);
  return useSyncExternalStore(view.subscribe, view.getSnapshot, view.getSnapshot);
}

/** Own a scope for the lifetime of a mounted component. */
export function useScope<S extends Scope>(create: () => S): S {
  const [scope] = useState(create);
  useEffect(() => {
    scope.activate();
    return () => scope.deactivate();
  }, [scope]);
  return scope;
}

/**
 * A stable getter for the latest render's value, refreshed after commit. Lets a
 * long-lived controller read current props/router state without recreating it.
 */
export function useLatest<T>(value: T): () => T {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return useCallback(() => ref.current, []);
}
