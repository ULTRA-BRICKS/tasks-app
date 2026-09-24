import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium, webkit } from '@playwright/test';
const root = resolve('dist');
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path.startsWith('/api/') || path === '/graphql') {
    response.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(
      JSON.stringify({
        error: { code: 'UNAUTHENTICATED', message: 'Synthetic anonymous session' },
      }),
    );
    return;
  }
  let file = resolve(root, '.' + path);
  if (!file.startsWith(root + sep)) file = resolve(root, 'index.html');
  try {
    if (!(await stat(file)).isFile()) throw new Error('not file');
  } catch {
    file = resolve(root, 'index.html');
  }
  const contentType =
    {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
    }[extname(file)] ?? 'application/octet-stream';
  response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-cache' });
  response.end(await readFile(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
try {
  for (const [name, launcher] of [
    ['chromium', chromium],
    ['webkit', webkit],
  ]) {
    const browser = await launcher.launch();
    try {
      const context = await browser.newContext(),
        page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(origin + '/login');
      await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
      });
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      const inspected = await page.evaluate(async () => {
        const keys = (await caches.keys()).filter((key) => key.startsWith('tasks-shell-'));
        return {
          keys,
          paths: await Promise.all(
            keys.map(async (key) =>
              (await (await caches.open(key)).keys()).map(
                (request) => new URL(request.url).pathname,
              ),
            ),
          ),
        };
      });
      assert.equal(inspected.keys.length, 1);
      assert(inspected.paths[0].includes('/index.html'));
      assert(inspected.paths[0].some((path) => /^\/assets\/.*\.js$/.test(path)));
      assert(
        inspected.paths[0].every((path) => !path.startsWith('/api/') && !path.includes('token')),
      );
      await context.setOffline(true);
      const started = Date.now();
      const response = await page.goto(origin + '/issues?view=synthetic', {
        waitUntil: 'domcontentloaded',
      });
      assert.equal(response.status(), 200);
      assert.equal(response.fromServiceWorker(), true);
      assert(await page.locator('script[src*="/assets/"]').count());
      await page.waitForFunction(() => Boolean(document.querySelector('#root')?.children.length));
      assert.equal(errors.length, 0, errors.join('; '));
      console.log(
        JSON.stringify({
          engine: name,
          shellFromServiceWorker: true,
          cacheEntries: inspected.paths[0].length,
          privateResponsesCached: false,
          offlineShellDomMs: Date.now() - started,
          authenticatedOfflineContentTested: false,
        }),
      );
      await context.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
