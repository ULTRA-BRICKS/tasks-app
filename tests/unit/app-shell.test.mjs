import { test, expect } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
function worker(previous = new Map()) {
  const handlers = {},
    store = new Map(),
    cache = {
      match: async (key) => store.get(String(key)),
      put: async (key, value) => store.set(String(key), value),
      addAll: async () => {},
    };
  const source = existsSync('public/sw.js') ? readFileSync('public/sw.js', 'utf8') : '';
  const context = {
    self: {
      addEventListener: (name, fn) => {
        handlers[name] = fn;
      },
      location: { origin: 'https://app.test' },
      clients: { claim: async () => {}, matchAll: async () => [] },
      registration: { update: async () => {} },
      skipWaiting: async () => {},
    },
    caches: {
      open: async (name) => previous.get(name) ?? cache,
      keys: async () => [...previous.keys()],
      delete: async () => {},
    },
    fetch: async () => {
      throw new Error('offline');
    },
    URL,
    Request,
    Response,
    Set,
    console,
  };
  vm.runInNewContext(source, context);
  return { handlers, cache };
}
test('public shell worker exists but never intercepts API, OAuth, invitations or mutations', async () => {
  const { handlers } = worker();
  expect(typeof handlers.fetch).toBe('function');
  for (const [url, method] of [
    ['/api/v1/issues', 'GET'],
    ['/graphql', 'POST'],
    ['/api/auth/reset-password', 'POST'],
    ['/invite?token=private', 'GET'],
    ['/reset-password', 'GET'],
    ['/.well-known/oauth-authorization-server', 'GET'],
    ['/assets/private.png', 'POST'],
  ]) {
    let handled = false;
    handlers.fetch({
      request: { url: 'https://app.test' + url, method, mode: 'navigate' },
      respondWith: () => {
        handled = true;
      },
      waitUntil: () => {},
    });
    expect(handled).toBe(false);
  }
});
test('cached shell navigation does not wait for the network or include route query data in cache keys', async () => {
  const { handlers, cache } = worker();
  expect(typeof handlers.fetch).toBe('function');
  await cache.put(
    '/index.html',
    new Response('<html>public application</html>', { headers: { 'Content-Type': 'text/html' } }),
  );
  /** @type {Array<Promise<Response>>} */
  const results = [];
  handlers.fetch({
    request: { url: 'https://app.test/issues?q=private-title', method: 'GET', mode: 'navigate' },
    respondWith: (value) => {
      results.push(Promise.resolve(value));
    },
    waitUntil: (value) => {
      void value.catch(() => {});
    },
  });
  expect(await (await results[0]).text()).toBe('<html>public application</html>');
});

test('already open tabs can still load a versioned lazy asset from a retained public cache', async () => {
  const previous = new Map([
    [
      'tasks-shell-older-build',
      {
        match: async (path) =>
          path === '/assets/editor-Abc12345.js' ? new Response('old public editor') : undefined,
      },
    ],
  ]);
  const { handlers } = worker(previous);
  /** @type {Array<Promise<Response>>} */
  const responses = [];
  handlers.fetch({
    request: { url: 'https://app.test/assets/editor-Abc12345.js', method: 'GET', mode: 'cors' },
    respondWith: (value) => responses.push(Promise.resolve(value)),
    waitUntil: () => {},
  });
  expect(responses).toHaveLength(1);
  expect(await (await responses[0]).text()).toBe('old public editor');
});
