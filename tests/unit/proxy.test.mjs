import { test, expect } from 'bun:test';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { DEFAULT_API_PORT } from '../../packages/config/development.mjs';

test('actual Vite proxy uses custom API_PORT and emits JSON if backend disappears', async () => {
  const api = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => Response.json({ status: 'ok', service: 'tickets-app' }),
  });
  expect(api.port).not.toBe(DEFAULT_API_PORT);
  const freeWeb = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response('temporary'),
  });
  const webPort = freeWeb.port;
  await freeWeb.stop(true);
  const child = spawn(process.execPath, ['--bun', 'vite', '--host', '127.0.0.1'], {
    env: {
      ...process.env,
      API_PORT: String(api.port),
      WEB_PORT: String(webPort),
      APP_URL: `http://localhost:${webPort}`,
      NODE_ENV: 'development',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (b) => (logs += b));
  child.stderr.on('data', (b) => (logs += b));
  try {
    let response;
    for (let i = 0; i < 100; i++) {
      try {
        response = await fetch(`http://127.0.0.1:${webPort}/api/health`);
        break;
      } catch {
        await delay(100);
      }
    }
    if (!response) throw new Error('Vite failed to start: ' + logs);
    expect(response.status).toBe(200);
    expect((await response.json()).service).toBe('tickets-app');
    const gql = await fetch(`http://127.0.0.1:${webPort}/graphql`, { method: 'POST' });
    expect(gql.status).toBe(200);
    await api.stop(true);
    const down = await fetch(`http://127.0.0.1:${webPort}/api/health`);
    expect(down.status).toBe(502);
    expect((await down.json()).error.code).toBe('API_UNAVAILABLE');
  } finally {
    child.kill('SIGTERM');
    await api.stop(true);
    await new Promise((resolve) => child.once('close', resolve));
  }
}, 20000);
