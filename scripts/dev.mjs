import { resolveDevelopment } from '../packages/config/development.mjs';
const config = resolveDevelopment(process.env);
const instance = crypto.randomUUID();
const env = {
  ...process.env,
  API_PORT: String(config.apiPort),
  WEB_PORT: String(config.webPort),
  APP_URL: config.appUrl,
  DEV_INSTANCE_ID: instance,
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
  const deadline = Date.now() + 15000;
  while (!stopped && Date.now() < deadline) {
    try {
      const r = await fetch(config.apiTarget + '/api/health', { signal: AbortSignal.timeout(800) });
      const health = r.ok ? await r.json() : null;
      if (health?.service === 'tickets-app' && health.instance === instance) {
        ready = true;
        break;
      }
    } catch {
      /* Retry only in this bounded startup window. */
    }
    await Bun.sleep(100);
  }
  if (!stopped && !ready)
    throw new Error(`API failed to start at ${config.apiTarget}. See its error above.`);
  if (!stopped) {
    console.log(`Tickets UI: ${config.appUrl}\nAPI: ${config.apiTarget}`);
    start(['run', 'dev:web']);
  }
} catch (error) {
  console.error(error.message);
  stop(1);
}
