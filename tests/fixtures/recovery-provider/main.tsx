import { StrictMode, useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DraftPersistenceProvider,
  useDraftPersistence,
  type DraftPersistenceView,
} from '../../../src/shared/lib/draft-persistence-context';
import type { DraftPorts, DraftStorage } from '../../../src/shared/lib/draft-persistence';
const key = 'input-draft:w:u:knowledge';
function storage(): DraftStorage {
  const entries = new Map<string, string>();
  return {
    getItem: (k) => entries.get(k) ?? null,
    setItem: (k, v) => void entries.set(k, v),
    removeItem: (k) => void entries.delete(k),
    key: (i) => [...entries.keys()][i] ?? null,
    get length() {
      return entries.size;
    },
  };
}
const local = storage(),
  session = storage();
let subscriptions = 0,
  connects = 0,
  disconnects = 0,
  current: DraftPersistenceView | undefined;
const retained: DraftPersistenceView[] = [];
const ports: DraftPorts = {
  local,
  session,
  storageEvents: () => {
    subscriptions++;
    connects++;
    let active = true;
    return () => {
      if (active) {
        active = false;
        subscriptions--;
        disconnects++;
      }
    };
  },
};
const audit = {
  get subscriptions() {
    return subscriptions;
  },
  get connects() {
    return connects;
  },
  get disconnects() {
    return disconnects;
  },
  get current() {
    return current;
  },
  retained,
  key,
  local,
  session,
};
Object.assign(window, { recoveryAudit: audit });
function Reader() {
  const store = useDraftPersistence();
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    current = store;
    if (!retained.includes(store)) retained.push(store);
  }, [store]);
  return (
    <div id="reader">
      <input
        aria-label="Draft text"
        onChange={(event) => store.setItem(key, event.target.value)}
        defaultValue={store.getItem(key) ?? ''}
      />
      <output id="draft-value">{store.getItem(key) ?? ''}</output>
    </div>
  );
}
function Page() {
  const [visible, setVisible] = useState(true);
  return (
    <main>
      <button id="toggle" onClick={() => setVisible((v) => !v)}>
        Toggle provider
      </button>
      {visible && (
        <DraftPersistenceProvider ports={ports}>
          <Reader />
        </DraftPersistenceProvider>
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
