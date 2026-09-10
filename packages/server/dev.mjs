import { withLinear } from '../linear/handler.mjs';
import { createDatabase, migrate } from '../db/index.mjs';
import { createApp } from './app.mjs';
const db = await createDatabase({
  url: process.env.DATABASE_URL,
  sqlitePath: process.env.SQLITE_PATH,
  production: process.env.NODE_ENV === 'production',
});
if (!process.env.DATABASE_URL) await migrate(db);
const app = withLinear(createApp({ db }), { db });
const server = Bun.serve({
  hostname: process.env.API_HOST || '127.0.0.1',
  port: Number(process.env.API_PORT) || 8787,
  maxRequestBodySize: 4 * 1024 * 1024,
  fetch: (request) => app.fetch(request),
  idleTimeout: 30,
});
console.log(`Tickets API ${server.url}`);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await server.stop(true);
    await db.close();
    process.exit(0);
  });
