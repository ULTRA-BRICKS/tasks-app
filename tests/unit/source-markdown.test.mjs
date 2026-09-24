import { test, expect } from 'bun:test';
import { markdownEquivalent } from '../../packages/server/modules/linear-import/source-contract.mjs';
test('Markdown equivalence ignores syntax-only normalization, not content or code', () => {
  expect(markdownEquivalent('## A\nText\n\n- one\n- two', '## A\n\nText\n\n* one\n* two')).toBe(
    true,
  );
  expect(markdownEquivalent('```js\nx()\n```', '```js\ny()\n```')).toBe(false);
  expect(markdownEquivalent('[x](https://example.com/a)', '[x](https://example.com/b)')).toBe(
    false,
  );
  expect(markdownEquivalent('- [ ] no', '- [x] no')).toBe(false);
  expect(markdownEquivalent('one', 'two')).toBe(false);
});
test('expiring Linear image signature is not a content change but its object path is', () => {
  expect(
    markdownEquivalent(
      '![x](https://uploads.linear.app/org/a?signature=old)',
      '![x](https://uploads.linear.app/org/a?signature=new)',
    ),
  ).toBe(true);
  expect(
    markdownEquivalent(
      '![x](https://uploads.linear.app/org/a?signature=old)',
      '![x](https://uploads.linear.app/org/b?signature=new)',
    ),
  ).toBe(false);
  expect(
    markdownEquivalent(
      '[x](https://example.com/?signature=a)',
      '[x](https://example.com/?signature=b)',
    ),
  ).toBe(false);
});
