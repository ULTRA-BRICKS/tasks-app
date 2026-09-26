/** Synthetic browser fixture: no account, API or persistent data is accessed. */
import { StrictMode, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { createRoot } from 'react-dom/client';
import { UiStateProvider, useLocalState } from '../../../src/shared/lib/state/local';
import { createUiRegistry } from '../../../src/shared/lib/state/ui-registry';
import { createScope } from '../../../src/shared/lib/state/scope';
import { useSelector } from '../../../src/shared/lib/state/react';
const registry = createUiRegistry();
const scope = createScope();
const source = scope.value({ a: 'Alpha', b: 'Beta' });
const alternate = scope.value({ a: 'Gamma', b: 'Delta' });
let late: Dispatch<SetStateAction<string>> = () => {};

function View({ field, changedSource }: { field: 'a' | 'b'; changedSource: boolean }) {
  const [count, setCount] = useLocalState(0);
  const [text, setText] = useLocalState('Draft');
  const selected = useSelector(changedSource ? alternate : source, (value) => value[field]);
  useEffect(() => {
    late = setText;
  }, [setText]);
  return (
    <>
      <output id="count">{count}</output>
      <output id="selected">{selected}</output>
      <input
        aria-label="Draft"
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
      />
      <button
        id="increase"
        onClick={() => {
          setCount((n) => n + 1);
          setCount((n) => n + 1);
        }}
      >
        Increase
      </button>
    </>
  );
}

function Harness() {
  const [shown, setShown] = useState(true);
  const [field, setField] = useState<'a' | 'b'>('a');
  const [changedSource, setChangedSource] = useState(false);
  const [owners, setOwners] = useState('{}');
  return (
    <UiStateProvider registry={registry}>
      <button id="toggle" onClick={() => setShown((value) => !value)}>
        Toggle
      </button>
      <button id="field" onClick={() => setField((value) => (value === 'a' ? 'b' : 'a'))}>
        Selector
      </button>
      <button id="source" onClick={() => setChangedSource((value) => !value)}>
        Source
      </button>
      <button id="old-source" onClick={() => source.set({ a: 'old-a', b: 'old-b' })}>
        Old source write
      </button>
      <button id="new-source" onClick={() => alternate.set({ a: 'new-a', b: 'new-b' })}>
        New source write
      </button>
      <button id="late" onClick={() => late('stale')}>
        Late update
      </button>
      <button id="inspect" onClick={() => setOwners(JSON.stringify(registry.inspect()))}>
        Inspect
      </button>
      <pre id="owners">{owners}</pre>
      {shown && <View field={field} changedSource={changedSource} />}
    </UiStateProvider>
  );
}
const target = document.getElementById('root');
if (!target) throw new Error('Fixture root missing');
createRoot(target).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
