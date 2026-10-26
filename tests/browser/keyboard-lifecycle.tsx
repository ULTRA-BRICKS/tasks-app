/** Real keyboard components; deterministic committed-route/passive-effect boundary. */
import { createRoot } from 'react-dom/client';
import { StrictMode, Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkspaceKeyboard as NativeKeyboard } from '../../src/features/keyboard/baseline';
import { WorkspaceKeyboard as StateKeyboard } from '../../src/features/keyboard/state-lib';

const query = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});
query.setQueryData(['me'], {
  id: 'synthetic-keyboard-user',
  role: 'member',
  workspace_id: 'fixture',
});
const Keyboard =
  new URLSearchParams(location.search).get('backend') === 'baseline'
    ? NativeKeyboard
    : StateKeyboard;
function Boundary() {
  const route = useLocation(),
    navigate = useNavigate();
  const [emitAtCommit, setEmitAtCommit] = useState(false);
  const emitted = useRef(false);
  useLayoutEffect(() => {
    if (new URLSearchParams(location.search).get('startup') === '1')
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true }),
      );
  }, []);
  const settled = useRef<HTMLOutputElement>(null);
  useLayoutEffect(() => {
    if (emitAtCommit && route.pathname === '/issues' && !emitted.current) {
      emitted.current = true;
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: new URLSearchParams(location.search).has('escape') ? 'Escape' : 'g',
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  }, [emitAtCommit, route.pathname]);
  useEffect(() => {
    if (settled.current) settled.current.textContent = route.pathname;
  }, [route.pathname]);
  return (
    <main>
      <div className="issue-list">
        <div className="issue-row">
          <button className="issue-open">First visible issue</button>
        </div>
      </div>
      <output data-testid="route">{route.pathname}</output>
      <output ref={settled} data-testid="passive-route" />
      <button
        onClick={() => {
          setEmitAtCommit(true);
          void navigate('/issues');
        }}
      >
        Navigate and begin chord at commit
      </button>
      <button
        onClick={() => {
          void navigate('/issues');
        }}
      >
        Navigate without beginning chord
      </button>
      <input aria-label="Editor text" />
    </main>
  );
}
const Replay = new URLSearchParams(location.search).has('strict') ? StrictMode : Fragment;
createRoot(document.getElementById('fixture')!).render(
  <Replay>
    <QueryClientProvider client={query}>
      <MemoryRouter initialEntries={[{ pathname: '/issues/start', state: { from: '/projects' } }]}>
        <Keyboard onSearch={() => {}} />
        <Boundary />
      </MemoryRouter>
    </QueryClientProvider>
  </Replay>,
);
