import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createUiRegistry } from '../../src/shared/lib/state/ui-registry';

test('the local-state API renders via a supplied application registry without global ownership', async () => {
  expect(existsSync('src/shared/lib/state/local.tsx')).toBe(true);
  const { UiStateProvider, useLocalState } = await import('../../src/shared/lib/state/local');
  const registry = createUiRegistry();
  function View() {
    const [title] = useLocalState(() => 'New issue');
    return <span>{title}</span>;
  }
  expect(
    renderToStaticMarkup(
      <UiStateProvider registry={registry}>
        <View />
      </UiStateProvider>,
    ),
  ).toBe('<span>New issue</span>');
  expect(registry.inspect()).toEqual({});
  registry.dispose();
});
