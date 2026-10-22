import { readdir, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';

// Build a closed public-file inventory from immutable dist. Symlinks, dotfiles and
// source maps are never public. Requests cannot choose arbitrary filesystem paths.
export async function createPublicApp(app, directory) {
  const root = await realpath(directory),
    files = new Map();
  async function collect(folder, prefix = '') {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name.endsWith('.map')) continue;
      const path = join(folder, entry.name),
        url = prefix + '/' + entry.name;
      if (entry.isDirectory()) await collect(path, url);
      else if (entry.isFile()) files.set(url, path);
    }
  }
  await collect(root);
  if (!files.has('/index.html') || !(await stat(files.get('/index.html'))).isFile())
    throw new Error('Built public index.html is required');
  const response = (message, status) =>
    new Response(message, {
      status,
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
  return {
    async fetch(request) {
      let path;
      try {
        path = decodeURIComponent(new URL(request.url).pathname);
      } catch {
        return response('Not found', 404);
      }
      if (
        path === '/api' ||
        path.startsWith('/api/') ||
        path === '/graphql' ||
        path.startsWith('/.well-known/')
      )
        return app.fetch(request);
      if (!['GET', 'HEAD'].includes(request.method)) return response('Method not allowed', 405);
      if (
        path.includes('\\') ||
        path.includes('\0') ||
        path.split('/').some((p) => p.startsWith('.'))
      )
        return response('Not found', 404);
      let file = files.get(path);
      if (!file) {
        if (path.startsWith('/assets/') || path.split('/').at(-1).includes('.'))
          return response('Not found', 404);
        file = files.get('/index.html');
      }
      const data = Bun.file(file);
      return new Response(request.method === 'HEAD' ? null : data, {
        headers: {
          'content-type': data.type,
          'content-length': String(data.size),
          'cache-control': path.startsWith('/assets/')
            ? 'public, max-age=31536000, immutable'
            : 'no-store',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          'x-frame-options': 'DENY',
        },
      });
    },
  };
}
