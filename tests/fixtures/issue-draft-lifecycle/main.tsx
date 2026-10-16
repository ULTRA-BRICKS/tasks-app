import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Actor, Catalog } from '@tickets/contracts';
import { NewIssuePage } from '../../../src/pages/issue-new/state-lib';
import { UiStateProvider } from '../../../src/shared/lib/state/local';
import { createUiRegistry } from '../../../src/shared/lib/state/ui-registry';
import '../../../src/app/styles.css';

// Synthetic identities only. Every identity change goes through the same QueryClient the page reads.
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});
const actor = (id: string, name = id): Actor => ({
  id,
  workspace_id: 'synthetic-workspace',
  name,
  email: id + '@example.invalid',
  role: 'owner',
  scopes: [],
  auth_type: 'session',
});
const catalog: Catalog = {
  workspace: { id: 'synthetic-workspace', name: 'Synthetic', slug: 'synthetic' },
  teams: [{ id: 'team', workspace_id: 'synthetic-workspace', key: 'SYN', name: 'Synthetic' }],
  statuses: [
    {
      id: 'todo',
      team_id: 'team',
      name: 'Todo',
      category: 'unstarted',
      color: '#888',
      position: 0,
    },
  ],
  labels: [],
  people: [],
  modules: [],
};
client.setQueryData(['me'], actor('first'));
client.setQueryData(['catalog'], catalog);
for (const key of ['projects', 'cycles', 'milestones', 'views']) client.setQueryData([key], []);
const registry = createUiRegistry();
let refetches = 0;
// Deterministic signal for "a successful create was fully handled": onCreated invalidates the
// seeded ['projects'] query, which is the only cache event the success path emits.
Object.assign(window, { createdCount: 0 });
client.getQueryCache().subscribe((event) => {
  if (event.type === 'updated' && event.action.type === 'invalidate')
    Reflect.set(window, 'createdCount', Number(Reflect.get(window, 'createdCount')) + 1);
});

function Fixture() {
  const [shown, setShown] = useState(true);
  const location = useLocation();
  return (
    <>
      <div style={{ display: 'flex', gap: 12, padding: 12 }}>
        <button id="first" onClick={() => client.setQueryData(['me'], actor('first'))}>
          First account
        </button>
        <button id="second" onClick={() => client.setQueryData(['me'], actor('second'))}>
          Second account
        </button>
        <button
          id="same-ids"
          onClick={() => {
            const current = client.getQueryData<Actor>(['me']);
            client.setQueryData(['me'], actor(current?.id ?? 'first', 'Refetched ' + ++refetches));
          }}
        >
          Refetch same identity
        </button>
        {/* removeQueries leaves the mounted observer on its old result; reset drops the data and refetches. */}
        <button
          id="waiting"
          onClick={() => void client.resetQueries({ queryKey: ['me'], exact: true })}
        >
          Clear identity
        </button>
        <button id="toggle" onClick={() => setShown((value) => !value)}>
          Toggle page
        </button>
        <output id="location">{location.pathname}</output>
      </div>
      {shown ? <NewIssuePage /> : null}
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <UiStateProvider registry={registry}>
        <MemoryRouter initialEntries={['/issues/new']}>
          <Fixture />
        </MemoryRouter>
      </UiStateProvider>
    </QueryClientProvider>
  </StrictMode>,
);
