import { withLinear } from '../linear/handler.mjs';
import { createDatabase, migrate } from '../db/index.mjs';
import { createApp } from './app.mjs';
import { resolveDevelopment } from '../config/development.mjs';
const config = resolveDevelopment(process.env);
const db = await createDatabase({
  url: process.env.DATABASE_URL,
  sqlitePath: config.sqlitePath,
  production: process.env.NODE_ENV === 'production',
});
if (!process.env.DATABASE_URL) await migrate(db);
const app = withLinear(
  createApp({
    db,
    defer: (task) => {
      void task.catch(() => console.error('Account mail task failed'));
    },
  }),
  { db },
);
const server = Bun.serve({
  hostname: config.apiHost,
  port: config.apiPort,
  maxRequestBodySize: 4 * 1024 * 1024,
  fetch: (request) => app.fetch(request),
  idleTimeout: 30,
});
console.log(`Tasks API ${server.url}`);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await server.stop(true);
    await db.close();
    process.exit(0);
  });
