import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { resolveDevelopment } from '../packages/config/development.mjs';

// The server harness creates a separate synthetic in-memory DB for every run.
// Force a local origin even when the shell carries a production APP_URL.
const root = fileURLToPath(new URL('..', import.meta.url));
const dev = resolveDevelopment({
  API_PORT: process.env.API_PORT ?? '6363',
  WEB_PORT: process.env.WEB_PORT ?? '6362',
});
const evidence = resolve(root, process.env.PILOT_EVIDENCE ?? 'test-results/state-lib-ab');
mkdirSync(evidence, { recursive: true });
for (const backend of ['state-lib', 'baseline']) {
  console.log(`Verifying real application backend: ${backend}`);
  const child = spawn(
    process.execPath,
    [
      '--bun',
      'playwright',
      'test',
      'tests/e2e/state-lib-pilot.spec.ts',
      'tests/e2e/inline.spec.ts',
      '--grep',
      'state-lib pilot|opening a new page|estimate and dates chosen',
      '--project=chromium',
      '--project=webkit',
      '--output',
      resolve(evidence, backend),
    ],
    {
      cwd: root,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: {
        ...process.env,
        API_HOST: '127.0.0.1',
        NODE_ENV: 'test',
        API_PORT: String(dev.apiPort),
        WEB_PORT: String(dev.webPort),
        APP_URL: `http://localhost:${dev.webPort}`,
        VITE_STATE_BACKEND: backend,
        PLAYWRIGHT_HTML_OUTPUT_DIR: resolve(evidence, `${backend}-report`),
      },
    },
  );
  const interrupt = () => {
    child.kill('SIGINT');
  };
  const terminate = () => {
    child.kill('SIGTERM');
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  try {
    const [exit] = await once(child, 'exit');
    if (typeof exit !== 'number' || exit !== 0) process.exit(typeof exit === 'number' ? exit : 1);
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  }
}
