/* Generated build replaces this public-only manifest. Private responses never enter CacheStorage. */
const SHELL_VERSION = '__TASKS_SHELL_VERSION__';
const PRECACHE = ['__TASKS_SHELL_ASSETS__'];
const CACHE = 'tasks-shell-' + SHELL_VERSION;
const assets = new Set(PRECACHE);
const appRoute =
  /^\/(?:tasks|my-tasks|issues|my-issues|epics|archive|projects|cycles|documents|initiatives|inbox|settings|login)(?:\/|$)/;
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = (await caches.keys()).filter((name) => name.startsWith('tasks-shell-'));
      // Keep at most two earlier public bundles for still-open tabs and their lazy imports.
      await Promise.all(
        names
          .filter((name) => name !== CACHE)
          .slice(0, -2)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_TASKS_UPDATE') void self.skipWaiting();
});
async function shell(event) {
  const cacheReady = caches.open(CACHE);
  const update = (async () => {
    const cache = await cacheReady;
    const response = await fetch('/index.html', { cache: 'no-cache', credentials: 'omit' });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html'))
      throw new Error('Invalid shell');
    const html = await response.clone().text();
    const references = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g)].map(
      (match) => match[1],
    );
    // Never replace the shell with HTML whose versioned assets are not installed together.
    if (references.length && references.every((path) => assets.has(path)))
      await cache.put('/index.html', response.clone());
    else await self.registration.update();
    return response;
  })();
  event.waitUntil(update.catch(() => undefined));
  const saved = await (await cacheReady).match('/index.html');
  if (saved) return saved;
  try {
    return await update;
  } catch {
    return new Response('Tasks is offline. Reconnect once to save its application shell.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}
self.addEventListener('fetch', (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && (url.pathname === '/' || appRoute.test(url.pathname))) {
    event.respondWith(shell(event));
    return;
  }
  const currentAsset = assets.has(url.pathname);
  if (!currentAsset && !/^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?)$/.test(url.pathname))
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE),
        saved = await cache.match(url.pathname);
      if (saved) return saved;
      if (!currentAsset) {
        const names = (await caches.keys()).filter(
          (name) => name.startsWith('tasks-shell-') && name !== CACHE,
        );
        for (const name of names.reverse()) {
          const previous = await (await caches.open(name)).match(url.pathname);
          if (previous) return previous;
        }
        // Unknown assets are fetched normally but never persisted by this worker.
        return fetch(request);
      }
      const response = await fetch(request);
      if (
        response.ok &&
        response.type !== 'opaque' &&
        !response.headers.get('content-type')?.includes('text/html')
      )
        await cache.put(url.pathname, response.clone());
      return response;
    })(),
  );
});
