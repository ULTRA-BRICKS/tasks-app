import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
const root = resolve('src'),
  layers = ['shared', 'entities', 'features', 'widgets', 'pages', 'app'];
async function walk(dir) {
  const files = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(path)));
    else if (/\.(ts|tsx|mjs)$/.test(e.name)) files.push(path);
  }
  return files;
}
const files = await walk(root),
  errors = [];
for (const file of files) {
  if (file.includes('.stories.') || file.includes('.test.')) continue;
  const source = relative(root, file).split('/'),
    layer = source[0],
    text = await readFile(file, 'utf8');
  // HyperIDE generates this untracked canvas harness outside the shipped app.
  // A tracked file or application import is still an error; never hide app slices.
  if (
    file === resolve(root, '__canvas_preview__.tsx') &&
    text.startsWith('// @ts-nocheck\n// @hyperide-preview-schema:') &&
    Bun.spawnSync(['git', 'ls-files', '--error-unmatch', '--', file], {
      stdout: 'ignore',
      stderr: 'ignore',
    }).exitCode === 1
  )
    continue;
  if (!layers.includes(layer)) {
    errors.push(`${file}: unknown FSD layer`);
    continue;
  }
  for (const match of text.matchAll(/(?:from\s*|import\s*\()(['"])([^'"\n]+)\1/g)) {
    const specifier = match[2];
    if (specifier.includes('__canvas_preview__'))
      errors.push(`${file}: production code must not import the IDE preview harness`);
    if (!specifier.startsWith('@/') && !specifier.startsWith('.')) continue;
    const target = specifier.startsWith('@/')
      ? resolve(root, specifier.slice(2))
      : resolve(dirname(file), specifier);
    if (!target.startsWith(root + '/')) {
      errors.push(`${file}: relative import escapes src: ${specifier}`);
      continue;
    }
    const dest = relative(root, target).split('/'),
      toLayer = dest[0];
    if (!layers.includes(toLayer)) continue;
    if (layers.indexOf(toLayer) > layers.indexOf(layer))
      errors.push(`${file}: upward import ${specifier}`);
    if (toLayer === layer && !['app', 'shared'].includes(layer) && dest[1] !== source[1])
      errors.push(`${file}: cross-slice import ${specifier}`);
    if (
      toLayer !== layer &&
      !['app', 'shared'].includes(toLayer) &&
      dest.length > 2 &&
      dest[2] !== 'index'
    )
      errors.push(`${file}: use slice public API ${specifier}`);
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log(`FSD import boundaries pass (${files.length} source files).`);
