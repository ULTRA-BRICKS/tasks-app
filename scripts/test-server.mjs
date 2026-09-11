import { withLinear } from '../packages/linear/handler.mjs';
import { resolveDevelopment } from '../packages/config/development.mjs';
import { createDatabase, migrate } from '../packages/db/index.mjs';
import { seedDemo } from '../packages/server/demo.mjs';
import { createApp } from '../packages/server/app.mjs';

const config = resolveDevelopment(process.env);
const db = await createDatabase({ sqlitePath: ':memory:' });
await migrate(db);
await seedDemo(db);
// Deterministic fixtures only; never read or mutate a deployed database here.
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
const env = {
  NODE_ENV: 'test',
  APP_URL: config.appUrl,
  AUTH_SECRET: 'synthetic-e2e-secret-not-used-in-production',
};
const app = withLinear(createApp({ db, env }), { db, env });
const server = Bun.serve({
  hostname: config.apiHost,
  port: config.apiPort,
  fetch: (request) => app.fetch(request),
});
const vite = Bun.spawn([process.execPath, 'run', 'dev:web'], {
  env: {
    ...process.env,
    NODE_ENV: 'test',
    API_PORT: String(config.apiPort),
    WEB_PORT: String(config.webPort),
    APP_URL: config.appUrl,
  },
  stdout: 'inherit',
  stderr: 'inherit',
});
let stopping;
function stop() {
  return (stopping ??= (async () => {
    vite.kill('SIGTERM');
    await server.stop(true);
    await db.close();
  })());
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void stop());
void vite.exited.then(async (code) => {
  await stop();
  process.exitCode = code;
});
