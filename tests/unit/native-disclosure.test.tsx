import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Disclosure } from '../../src/shared/ui/disclosure';
import { UiStateProvider } from '../../src/shared/lib/state/local';
import { createUiRegistry } from '../../src/shared/lib/state/ui-registry';

function View() {
  return (
    <Disclosure summary="Configure">
      <input aria-label="inside" />
    </Disclosure>
  );
}

test('disclosure renders a native closed details/summary and registers one UI owner', () => {
  const registry = createUiRegistry();
  const html = renderToStaticMarkup(
    <UiStateProvider registry={registry}>
      <View />
    </UiStateProvider>,
  );
  expect(html).toBe(
    '<details><summary>Configure</summary><input aria-label="inside"/></details>',
  );
  registry.dispose();
});

test('open state is driven by the registered owner, not a post-render DOM overwrite', () => {
  const registry = createUiRegistry();
  const markup = () =>
    renderToStaticMarkup(
      <UiStateProvider registry={registry}>
        <Disclosure summary="Configure" defaultOpen>
          <p>body</p>
        </Disclosure>
      </UiStateProvider>,
    );
  expect(markup()).toContain('<details open="">');
  registry.dispose();
});
