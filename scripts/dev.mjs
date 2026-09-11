import { setTimeout as delay } from 'node:timers/promises';
import { resolveDevelopment } from '../packages/config/development.mjs';

const config = resolveDevelopment(process.env);
const env = {
  ...process.env,
  API_PORT: String(config.apiPort),
  WEB_PORT: String(config.webPort),
  APP_URL: config.appUrl,
};
const children = [];
let stopped = false;
function stop(code = 0) {
  if (stopped) return;
  stopped = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
function start(args) {
  const child = Bun.spawn([process.execPath, ...args], {
    env,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });
  children.push(child);
  void child.exited.then((code) => stop(code));
  return child;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
try {
  start(['packages/server/dev.mjs']);
  let ready = false;
  const end = Date.now() + 15000;
  while (!stopped && Date.now() < end) {
    try {
      const response = await fetch(config.apiTarget + '/api/health', {
        signal: AbortSignal.timeout(1000),
      });
      const health = response.ok ? await response.json() : null;
      if (health?.status === 'ok' && health?.service === 'tickets-app') {
        ready = true;
        break;
      }
    } catch {
      /* Wait only during the bounded startup window. */
    }
    await delay(100);
  }
  if (!stopped && !ready)
    throw new Error(
      `API did not become ready at ${config.apiTarget}. Check its startup error above.`,
    );
  if (!stopped) {
    console.log(`Tickets UI: ${config.appUrl}\nAPI proxy target: ${config.apiTarget}`);
    start(['run', 'dev:web']);
  }
} catch (error) {
  console.error(error.message);
  stop(1);
}
