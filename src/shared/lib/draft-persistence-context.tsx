/**
 * Supplies the recovery-draft store. Baseline: the standalone page-lifetime facade, as
 * before. state-lib: one store per mounted provider, owned by a scope; there is no
 * module-level fallback, so a store cannot outlive or cross the app that created it.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  browserDraftPorts,
  draftPersistence,
  type DraftPersistence,
  type DraftPorts,
} from './draft-persistence';
import { createScopedDraftPersistence } from './draft-persistence-scope';
import { createScope } from './state/scope';
import { useScope } from './state/react';

export type DraftPersistenceView = Omit<
  DraftPersistence,
  'writerId' | 'disposed' | 'dispose' | 'connect'
>;
const baseline = import.meta.env.VITE_STATE_BACKEND === 'baseline';
const Context = createContext<DraftPersistence | null>(null);

function OwnedProvider({ children, ports }: { children: ReactNode; ports?: DraftPorts }) {
  const scope = useScope(() => createScope());
  const [store] = useState(() => createScopedDraftPersistence(scope, ports ?? browserDraftPorts()));
  useEffect(() => store.connect(), [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function DraftPersistenceProvider(props: { children: ReactNode; ports?: DraftPorts }) {
  return baseline ? props.children : <OwnedProvider {...props} />;
}
function useOwnedDraftPersistence(): DraftPersistenceView {
  const store = useContext(Context);
  if (!store) throw new Error('DraftPersistenceProvider is missing');
  return store;
}
export const useDraftPersistence: () => DraftPersistenceView = baseline
  ? () => draftPersistence
  : useOwnedDraftPersistence;
