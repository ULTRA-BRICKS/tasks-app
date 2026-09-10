import { readFile, writeFile, chmod, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const demo = process.argv.includes('--demo');
if (!process.versions.bun) throw new Error('Use Bun 1.4.2 or later.');
const file = '.env.local';
let existing = false;
try {
  await access(file);
  existing = true;
} catch {}
if (!existing) {
  let env = await readFile('.env.example', 'utf8');
  for (const key of ['AUTH_SECRET', 'CRON_SECRET'])
    env = env.replace(
      new RegExp(`^${key}=$`, 'm'),
      `${key}=${randomBytes(32).toString('base64url')}`,
    );
  await writeFile(file, env, { mode: 0o600, flag: 'wx' });
  await chmod(file, 0o600);
  console.log('Created .env.local with private random secrets.');
} else console.log('Existing .env.local preserved.');
function run(args) {
  const result = Bun.spawnSync([process.execPath, ...args], {
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });
  if (result.exitCode !== 0) process.exit(result.exitCode);
}
run(['install', '--frozen-lockfile']);
run(['run', 'prepare:generated']);
if (demo) {
  const env = await readFile(file, 'utf8');
  if (/^DATABASE_URL=.+$/m.test(env) || /^NODE_ENV=production$/m.test(env))
    throw new Error('--demo refuses cloud/production databases.');
  run(['run', 'demo:seed']);
} else
  console.log(
    'Set BOOTSTRAP_EMAIL, BOOTSTRAP_NAME and BOOTSTRAP_PASSWORD privately, then run bun run db:migrate and bun run db:bootstrap.',
  );
console.log('Next: bun run dev.');
