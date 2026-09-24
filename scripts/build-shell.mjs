import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const assets = (await readdir('dist/assets'))
  .filter((name) => /\.(?:js|css|woff2?)$/.test(name))
  .sort()
  .map((name) => '/assets/' + name);
const files = ['/index.html', '/favicon.svg', '/shell-register.js', ...assets];
const template = await readFile('public/sw.js', 'utf8');
const hash = createHash('sha256').update(template);
for (const file of files) hash.update(file).update(await readFile('dist' + file));
const version = hash.digest('hex').slice(0, 20);

if (!template.includes('__TASKS_SHELL_VERSION__') || !template.includes("'__TASKS_SHELL_ASSETS__'"))
  throw new Error('Worker template markers are missing');
const worker = template
  .replace('__TASKS_SHELL_VERSION__', version)
  .replace("'__TASKS_SHELL_ASSETS__'", files.map((path) => JSON.stringify(path)).join(','));
await writeFile('dist/sw.js', worker);
console.log('Public app shell:', version, files.length, 'assets; private API responses excluded.');
