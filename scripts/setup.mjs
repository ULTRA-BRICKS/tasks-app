import { readFile, open, unlink } from 'node:fs/promises';
import { setupOptions, buildLocalEnvironment, writeLocalEnvironment } from './setup-config.mjs';

async function main() {
  const options = setupOptions(process.argv.slice(2));
  if (options.help) {
    console.log(
      'bun run setup -- --demo [--port <API port>] [--web-port <UI port>]\nPort defaults come from packages/config/development.mjs. Existing data and secrets are preserved.',
    );
    return;
  }
  const file = '.env.local',
    lockFile = `${file}.setup-lock`;
  const lock = await open(lockFile, 'wx', 0o600).catch((error) => {
    if (error.code === 'EEXIST')
      throw new Error('Another setup is running. Finish it before trying again.');
    throw error;
  });
  try {
    let text,
      existing = true;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      text = await readFile('.env.example', 'utf8');
      existing = false;
    }
    const resolved = buildLocalEnvironment(text, options, process.env);
    await writeLocalEnvironment(file, resolved.text);
    console.log(
      `✓ ${file} ${existing ? 'updated; existing secrets preserved' : 'created with private random secrets'}`,
    );
    const run = (args) => {
      const result = Bun.spawnSync([process.execPath, ...args], {
        env: resolved.env,
        stdout: 'inherit',
        stderr: 'inherit',
        stdin: 'inherit',
      });
      if (result.exitCode)
        throw new Error(
          `Setup command failed (${result.exitCode}); existing database was not removed`,
        );
    };
    run(['install', '--frozen-lockfile']);
    run(['run', 'prepare:generated']);
    if (options.demo) run(['scripts/db.mjs', 'demo']);
    else
      console.log(
        'Set owner credentials privately, then run bun run db:migrate and bun run db:bootstrap.',
      );
    console.log(
      `✓ API: ${resolved.config.apiTarget}\n✓ UI: ${resolved.config.appUrl}\nNext: bun run dev (no repeated API_PORT required)`,
    );
  } finally {
    await lock.close();
    await unlink(lockFile);
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
