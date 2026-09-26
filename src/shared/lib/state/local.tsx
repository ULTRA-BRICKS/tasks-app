import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { createUiRegistry, type UiRegistry } from './ui-registry';

const Context = createContext<UiRegistry | null>(null);
const baseline = import.meta.env.VITE_STATE_BACKEND === 'baseline';
function OwnedProvider({ children, registry }: { children: ReactNode; registry?: UiRegistry }) {
  const [created] = useState(() => registry ?? createUiRegistry());
  const root = registry ?? created;
  useEffect(() => root.retain(), [root]);
  return <Context.Provider value={root}>{children}</Context.Provider>;
}
export function UiStateProvider(props: { children: ReactNode; registry?: UiRegistry }) {
  return baseline ? props.children : <OwnedProvider {...props} />;
}
const isInitializer = <T,>(value: T | (() => T)): value is () => T => typeof value === 'function';
const isUpdater = <T,>(value: SetStateAction<T>): value is (previous: T) => T =>
  typeof value === 'function';

function useOwnedState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
function useOwnedState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
function useOwnedState<S>(initial?: S | (() => S)) {
  const context = useContext(Context);
  const [fallback] = useState(() => context ?? createUiRegistry());
  const registry = context ?? fallback,
    id = useId();
  const [seed] = useState(() => (isInitializer(initial) ? initial() : initial));
  const entry = useMemo(() => registry.value(`/ui/${id}`, seed), [registry, id, seed]);
  useEffect(() => registry.retain(), [registry]);
  const subscribe = useCallback(
    (notify: () => void) => {
      const detach = entry.attach();
      try {
        const stop = entry.subscribe(notify);
        return () => {
          stop();
          detach();
        };
      } catch (error) {
        detach();
        throw error;
      }
    },
    [entry],
  );
  const value = useSyncExternalStore(subscribe, entry.getSnapshot, entry.getSnapshot);
  const set = useCallback(
    (action: SetStateAction<S | undefined>) => {
      if (isUpdater(action)) entry.update(action);
      else entry.set(action);
    },
    [entry],
  );
  const result: [S | undefined, Dispatch<SetStateAction<S | undefined>>] = [value, set];
  return result;
}
/** Build-time alternate owner with the existing useState call contract. */
export const useLocalState: typeof useState = baseline ? useState : useOwnedState;
