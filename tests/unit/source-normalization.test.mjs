import { test, expect } from 'bun:test';
import { markdownEquivalent } from '../../packages/server/modules/linear-import/source-contract.mjs';
test('Linear-generated autolinks preserve visible content without equating changed destinations', () => {
  expect(
    markdownEquivalent(
      'See apply.py/Nix for details.',
      'See [apply.py/Nix](<http://apply.py/Nix>) for details.',
    ),
  ).toBe(true);
  expect(
    markdownEquivalent(
      'Open git.hyperide.ai/ultrabricks/vecli.',
      'Open [git.hyperide.ai/ultrabricks/vecli](<http://git.hyperide.ai/ultrabricks/vecli>).',
    ),
  ).toBe(true);
  expect(markdownEquivalent('[apply.py](http://evil.example)', 'apply.py')).toBe(false);
  expect(
    markdownEquivalent('[https://good.example](http://good.example)', 'https://good.example'),
  ).toBe(false);
});
test('Linear emphasis splitting around inline code is formatting-only, code values still differ', () => {
  expect(
    markdownEquivalent(
      '**Guard (apply.py `plan()`)**: description',
      '**Guard ([apply.py](<http://apply.py>)** `plan()`**)**: description',
    ),
  ).toBe(true);
  expect(markdownEquivalent('**Guard `plan()`**', '**Guard `delete()`**')).toBe(false);
  expect(markdownEquivalent('**Important**', 'Important')).toBe(false);
});
