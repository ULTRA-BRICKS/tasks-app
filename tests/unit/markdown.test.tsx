import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../../src/shared/ui/markdown';

test('read-only GFM task checkboxes expose their own accessible names', () => {
  const html = renderToStaticMarkup(
    <Markdown>{'- [x] Works with a **keyboard**\n- [ ] Preserves a local draft'}</Markdown>,
  );
  expect(html).toContain('aria-label="Works with a keyboard"');
  expect(html).toContain('aria-label="Preserves a local draft"');
  expect(html.match(/disabled=""/g)).toHaveLength(2);
});
test('nested task names do not absorb their children and raw HTML stays disabled', () => {
  const html = renderToStaticMarkup(
    <Markdown>{'- [x] Parent task\n  - [ ] Child task\n\n<script>alert(1)</script>'}</Markdown>,
  );
  expect(html).toContain('aria-label="Parent task"');
  expect(html).toContain('aria-label="Child task"');
  expect(html).not.toContain('<script');
});
