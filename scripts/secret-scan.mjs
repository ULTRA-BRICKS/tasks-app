import { forbiddenTrackedPaths } from './secret-rules.mjs';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
const root = resolve('.'),
  excluded = new Set([
    '.git',
    'node_modules',
    '.data',
    '.vercel',
    'dist',
    'storybook-static',
    'test-results',
    'playwright-report',
    'coverage',
  ]);
const rules = [
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{35,})\b/, 'GitHub credential'],
  [/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/, 'Slack credential'],
  [
    /postgres(?:ql)?:\/\/[^\s:'"/]+:[^\s@'"/]+@[^\s'";]*\.(?:neon\.tech|supabase\.co)/,
    'database connection credential',
  ],
];
let checked = 0,
  failed = false;
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (excluded.has(e.name)) continue;
    const path = resolve(dir, e.name),
      rel = relative(root, path);
    if (e.isDirectory()) {
      await walk(path);
      continue;
    }
    if (e.name.startsWith('.env') && e.name !== '.env.example') continue; // excluded by .gitignore and archive tooling
    if (/\.(png|jpg|jpeg|webp|zip|bundle|woff2?|ttf|otf)$/.test(e.name)) continue;
    const text = await readFile(path, 'utf8');
    checked++;
    for (const [pattern, label] of rules)
      if (pattern.test(text)) {
        console.error(`${rel}: possible ${label}; value deliberately withheld`);
        failed = true;
      }
  }
}
const listed = Bun.spawnSync(['git', 'ls-files', '--cached', '-z'], {
  stdout: 'pipe',
  stderr: 'pipe',
});
if (listed.exitCode) throw new Error('Unable to inspect tracked paths; secret scan fails closed.');
for (const path of forbiddenTrackedPaths(listed.stdout.toString().split('\0').filter(Boolean))) {
  console.error(
    `${JSON.stringify(path)}: private runtime/configuration file is tracked; contents withheld`,
  );
  failed = true;
}
await walk(root);
if (failed) process.exitCode = 1;
else
  console.log(
    `Credential-pattern scan passed (${checked} text files). This is not a security audit.`,
  );
