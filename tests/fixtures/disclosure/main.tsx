import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Disclosure } from '../../../src/shared/ui/disclosure';
import { UiStateProvider } from '../../../src/shared/lib/state/local';
import { createUiRegistry } from '../../../src/shared/lib/state/ui-registry';

// Synthetic fixture: one disclosure with a field inside, an unrelated re-render trigger and a
// registry handle for the browser test (state-lib build only; baseline has no registry owner).
const registry = createUiRegistry();
Object.assign(window, { registry });

function Page() {
  const [renders, setRenders] = useState(0);
  return (
    <main>
      <button id="rerender" onClick={() => setRenders((n) => n + 1)}>
        Re-render {renders}
      </button>
      <Disclosure
        summary="Configure"
        defaultOpen={
          new URLSearchParams(location.search).has('change-default')
            ? renders > 0
            : new URLSearchParams(location.search).has('open')
        }
      >
        <input id="inside" aria-label="inside" />
      </Disclosure>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UiStateProvider registry={registry}>
      <Page />
    </UiStateProvider>
  </StrictMode>,
);
