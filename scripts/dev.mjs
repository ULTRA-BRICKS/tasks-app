import { spawn } from 'node:child_process';
const children = [
  spawn(process.execPath, ['packages/server/dev.mjs'], { stdio: 'inherit' }),
  spawn(process.execPath, ['run', 'dev:web'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }),
];
let stopped = false;
function stop(code = 0) {
  if (stopped) return;
  stopped = true;
  for (const c of children) c.kill('SIGTERM');
  process.exitCode = code;
}
for (const c of children) {
  c.on('error', (e) => {
    console.error(e.message);
    stop(1);
  });
  c.on('exit', (code) => stop(code ?? 0));
}
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => stop());
