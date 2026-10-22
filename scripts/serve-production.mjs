import { resolve } from 'node:path';
import { parsePort } from '../packages/config/development.mjs';
import { createProductionRuntime } from '../packages/server/production-runtime.mjs';

const runtime = await createProductionRuntime(
  process.env,
  resolve(process.env.PUBLIC_DIRECTORY || 'dist'),
);
const server = Bun.serve({
  hostname: process.env.LISTEN_HOST || '0.0.0.0',
  port: parsePort(process.env.PORT, 8080, 'PORT'),
  maxRequestBodySize: 4 * 1024 * 1024,
  idleTimeout: 60,
  fetch: (request) => runtime.fetch(request),
});
console.log(
  JSON.stringify({
    event: 'http-listening',
    port: server.port,
    deployment: process.env.TASKS_DEPLOYMENT_ID,
  }),
);
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 55000);
    deadline.unref();
    try {
      await server.stop();
      await runtime.close();
      process.exit(0);
    } catch {
      console.error(JSON.stringify({ code: 'SHUTDOWN_FAILED' }));
      process.exit(1);
    }
  });
