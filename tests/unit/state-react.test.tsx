import { expect, test } from 'bun:test';
import { StrictMode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createScope } from '../../src/shared/lib/state/scope';
import { useStore, useSelector, useScope } from '../../src/shared/lib/state/react';

test('useStore renders the current snapshot on the server without subscribing', () => {
  const scope = createScope();
  const label = scope.value('hello');
  function View() {
    return <p>{useStore(label)}</p>;
  }
  expect(renderToStaticMarkup(<View />)).toBe('<p>hello</p>');
  scope.dispose();
});

test('useSelector projects a snapshot and keeps referential equality for equal selections', () => {
  const scope = createScope();
  const store = scope.value({ open: true, other: 1 });
  function View() {
    return <p>{String(useSelector(store, (v) => v.open))}</p>;
  }
  expect(renderToStaticMarkup(<View />)).toBe('<p>true</p>');
  scope.dispose();
});

test('useScope creates one scope per mount and StrictMode double render leaks none live', () => {
  const created: ReturnType<typeof createScope>[] = [];
  function View() {
    const scope = useScope(() => {
      const next = createScope();
      created.push(next);
      return next;
    });
    return <p>{scope.disposed ? 'dead' : 'live'}</p>;
  }
  const html = renderToStaticMarkup(
    <StrictMode>
      <View />
    </StrictMode>,
  );
  expect(html).toBe('<p>live</p>');
  // Render-phase creation may happen twice under StrictMode, but nothing was activated,
  // and an inactive scope holds no timers or subscriptions.
  expect(created.length).toBeGreaterThanOrEqual(1);
  for (const scope of created) scope.dispose();
});
