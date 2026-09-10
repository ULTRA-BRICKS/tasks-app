import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveTokens, generate, cssValue } from '../../scripts/tokens.mjs';
import { generateOpenAPI, toType } from '../../scripts/openapi.mjs';
const token = (type, value) => ({ $type: type, $value: value });
test('token aliases resolve into real CSS, TS and reference output', async () => {
  const tree = JSON.parse(
    await readFile(new URL('../../tokens/tickets.tokens.json', import.meta.url), 'utf8'),
  );
  const values = resolveTokens(tree);
  assert(values.size > 100);
  assert.equal(values.get('theme.dark.canvas').css, values.get('palette.dark.canvas').css);
  const files = generate(tree);
  assert.match(files['src/shared/styles/tokens.css'], /\[data-theme="light"\]/);
  assert.match(files['src/shared/config/tokens.ts'], /as const/);
});
test('token compiler rejects missing aliases', () =>
  assert.throws(() => resolveTokens({ x: token('number', '{missing}') }), /Unknown token/));
test('token compiler rejects circular aliases', () =>
  assert.throws(
    () => resolveTokens({ a: token('number', '{b}'), b: token('number', '{a}') }),
    /Circular/,
  ));
test('token compiler rejects alias type mismatch', () =>
  assert.throws(
    () =>
      resolveTokens({
        a: token('number', '{b}'),
        b: token('color', { colorSpace: 'srgb', components: [0, 0, 0] }),
      }),
    /type mismatch/,
  ));
test('typed DTCG values reject legacy raw hex and CSS injection', () => {
  assert.throws(() => cssValue('color', '#ffffff'));
  assert.throws(() => cssValue('dimension', { value: 1, unit: 'px; color:red' }));
  assert.throws(() => cssValue('fontFamily', ['sans-serif; display:none']));
  assert.throws(() => cssValue('cubicBezier', [2, 0, 0, 1]));
});
test('OpenAPI and request types share runtime contracts', () => {
  const api = generateOpenAPI();
  assert.equal(api.openapi, '3.1.0');
  assert(api.components.schemas.IssuePatch.required.includes('version'));
  assert.equal(
    api.paths['/v1/issues'].post.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/IssueCreate',
  );
  assert.match(toType(api.components.schemas.IssueCreate), /"title": string/);
});
