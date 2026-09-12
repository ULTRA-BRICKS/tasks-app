import { readFile } from 'node:fs/promises';
import { acquireSetupLock } from './setup-lock.mjs';
import { setupOptions, buildLocalEnvironment, writeLocalEnvironment } from './setup-config.mjs';
async function main() {
  const options = setupOptions(process.argv.slice(2));
  if (options.help) {
    console.log('bun run setup -- --demo [--port API_PORT] [--web-port WEB_PORT]');
    return;
  }
  const file = '.env.local',
    lockFile = file + '.setup-lock';
  const release = await acquireSetupLock(lockFile);
  try {
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      text = await readFile('.env.example', 'utf8');
    }
    const result = buildLocalEnvironment(text, options, process.env);
    await writeLocalEnvironment(file, result.text);
    console.log('✓ .env.local ready; existing secrets preserved');
    for (const args of [
      ['install', '--frozen-lockfile'],
      ['run', 'prepare:generated'],
      ...(options.demo ? [['scripts/db.mjs', 'demo']] : []),
    ]) {
      const p = Bun.spawnSync([process.execPath, ...args], {
        env: result.env,
        stdio: ['inherit', 'inherit', 'inherit'],
      });
      if (p.exitCode !== 0)
        throw new Error(`Setup stopped (${p.exitCode}); database was not removed`);
    }
    console.log(
      `✓ UI: ${result.config.appUrl}\n✓ API: ${result.config.apiTarget}\nNext: bun run dev`,
    );
  } finally {
    await release();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
