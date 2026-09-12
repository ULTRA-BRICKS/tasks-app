import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { resolveDevelopment } from './packages/config/development.mjs';
const config = resolveDevelopment({ ...loadEnv('development', process.cwd(), ''), ...process.env });
const proxy: ProxyOptions = {
  target: config.apiTarget,
  configure(server) {
    server.on('error', (_error, _request, response) => {
      if (!response || !('writeHead' in response) || response.headersSent) return;
      response.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(
        JSON.stringify({
          error: {
            code: 'API_UNAVAILABLE',
            message: `Tickets API is unavailable at ${config.apiTarget}. Check the API terminal.`,
          },
        }),
      );
    });
  },
};
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@tickets/contracts': fileURLToPath(
        new URL('./packages/contracts/types.ts', import.meta.url),
      ),
    },
  },
  server: {
    host: '127.0.0.1',
    port: config.webPort,
    strictPort: true,
    proxy: { '/api': proxy, '/graphql': proxy },
  },
  build: { sourcemap: true, target: 'es2022' },
});
