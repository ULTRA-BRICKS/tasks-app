import { resolveDevelopment } from '../packages/config/development.mjs';
const dev = resolveDevelopment(process.env);
import { withLinear } from '../packages/linear/handler.mjs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createDatabase, migrate } from '../packages/db/index.mjs';
import { seedDemo } from '../packages/server/demo.mjs';
import { createApp } from '../packages/server/app.mjs';
import { nodeHandler } from '../packages/server/node-adapter.mjs';
const db = await createDatabase({ sqlitePath: ':memory:' });
await migrate(db);
await seedDemo(db);
// These deterministic timestamps exist only in the isolated, synthetic e2e database.
await db.transaction(async (tx) => {
  for (const table of ['issues', 'comments', 'activity', 'projects', 'users'])
    await tx.exec(`UPDATE ${table} SET created_at=?`, ['2026-09-10T10:00:00.000Z']);
  for (const issue of await tx.all('SELECT id,number FROM issues')) {
    const timestamp = new Date(Date.UTC(2026, 8, 10, 9, 0, issue.number)).toISOString();
    await tx.exec('UPDATE issues SET created_at=?,updated_at=? WHERE id=?', [
      timestamp,
      timestamp,
      issue.id,
    ]);
  }
  for (const table of ['issues', 'comments', 'projects'])
    await tx.exec(`UPDATE ${table} SET updated_at=?`, ['2026-09-10T10:00:00.000Z']);
});
const server = createServer(
  nodeHandler(
    withLinear(
      createApp({
        db,
        env: {
          NODE_ENV: 'test',
          APP_URL: dev.appUrl,
          AUTH_SECRET: 'synthetic-e2e-secret-not-used-in-production',
        },
      }),
      {
        db,
        env: {
          APP_URL: dev.appUrl,
          AUTH_SECRET: 'synthetic-e2e-secret-not-used-in-production',
          NODE_ENV: 'test',
        },
      },
    ),
  ),
);
await new Promise((resolve) => server.listen(dev.apiPort, dev.apiHost, resolve));
// TASKS_E2E_WEB=preview serves the built dist (real Service Worker) with the same API proxy.
const web =
  process.env.TASKS_E2E_WEB === 'preview'
    ? [
        '--bun',
        'vite',
        'preview',
        '--host',
        '127.0.0.1',
        '--port',
        String(dev.webPort),
        '--strictPort',
      ]
    : ['run', 'dev:web'];
const vite = spawn(process.execPath, web, {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'test',
    API_PORT: String(dev.apiPort),
    WEB_PORT: String(dev.webPort),
    APP_URL: dev.appUrl,
  },
});
async function stop() {
  vite.kill('SIGTERM');
  server.close();
  await db.close();
}
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => void stop());
vite.on('exit', (code) => {
  void stop();
  process.exitCode = code ?? 0;
});
