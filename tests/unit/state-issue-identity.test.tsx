import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Actor } from '@tickets/contracts';
import { NewIssuePage } from '../../src/pages/issue-new/state-lib';
import { UiStateProvider } from '../../src/shared/lib/state/local';
import { createUiRegistry } from '../../src/shared/lib/state/ui-registry';

const actor: Actor = {
  id: 'user-a',
  workspace_id: 'workspace-a',
  name: 'A',
  email: 'a@example.invalid',
  role: 'owner',
  scopes: [],
  auth_type: 'session',
};

function render(seed?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  seed?.(client);
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <UiStateProvider registry={createUiRegistry()}>
        <MemoryRouter initialEntries={['/issues/new']}>
          <NewIssuePage />
        </MemoryRouter>
      </UiStateProvider>
    </QueryClientProvider>,
  );
  client.clear();
  return html;
}

test('new-issue page waits for a genuine identity: busy placeholder, no editor or controller', () => {
  const html = render();
  expect(/<section[^>]*aria-busy="true"/.test(html)).toBe(true);
  expect(html.includes('<textarea')).toBe(false);
  expect(html.includes('Private draft')).toBe(false);
});

test('new-issue page renders the editor once the identity is available', () => {
  const html = render((client) => client.setQueryData(['me'], actor));
  expect(html.includes('Private draft')).toBe(true);
  expect(html.includes('<textarea')).toBe(true);
  expect(/<section[^>]*aria-busy="true"/.test(html)).toBe(false);
});
