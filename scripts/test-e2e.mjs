import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const BROWSER_PROJECTS = ['chromium', 'webkit'];

// Each browser gets a fresh synthetic server/database and its own artifacts.
// Sharing one server made the second browser exhaust the real login rate limit, so the
// browsers run one after another rather than as one shared Playwright invocation.
export function browserProjectRuns(args = [], env = process.env) {
  const forwarded = [];
  const selected = new Set();
  let output = env.PLAYWRIGHT_OUTPUT_DIR || 'test-results';
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--project' || arg.startsWith('--project=')) {
      const project = arg === '--project' ? args[++index] : arg.slice('--project='.length);
      if (!project || project.startsWith('--'))
        throw new Error('--project requires chromium or webkit');
      if (project === 'visual') throw new Error('Use test:visual for visual checks.');
      if (!BROWSER_PROJECTS.includes(project))
        throw new Error(`Unsupported project ${project}; use chromium or webkit.`);
      selected.add(project);
    } else if (arg === '--output' || arg.startsWith('--output=')) {
      const value = arg === '--output' ? args[++index] : arg.slice('--output='.length);
      if (!value || value.startsWith('--')) throw new Error('--output requires a directory');
      output = value;
    } else forwarded.push(arg);
  }
  return BROWSER_PROJECTS.filter((project) => !selected.size || selected.has(project)).map(
    (project) => ({
      project,
      args: [
        '--bun',
        'playwright',
        'test',
        ...forwarded,
        `--project=${project}`,
        `--output=${resolve(output, project)}`,
      ],
      env: {
        ...env,
        PLAYWRIGHT_HTML_OUTPUT_DIR: resolve(
          env.PLAYWRIGHT_HTML_OUTPUT_DIR || 'playwright-report',
          project,
        ),
      },
    }),
  );
}

async function runProject(run) {
  console.log(`\n=== Isolated ${run.project} acceptance ===`);
  const child = spawn(process.execPath, run.args, { env: run.env, stdio: 'inherit' });
  let interrupted = false;
  const forwardSignal = (signal) => {
    interrupted = true;
    child.kill(signal);
  };
  const onInterrupt = () => forwardSignal('SIGINT');
  const onTerminate = () => forwardSignal('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  try {
    return await new Promise((done) => {
      child.once('error', (error) => {
        console.error(error.message);
        done(1);
      });
      child.once('exit', (code) => done(interrupted ? 130 : (code ?? 1)));
    });
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  }
}
// Every browser reports even after another fails; the first failure decides the exit code.
// An interruption (130) stops the remaining browsers.
export async function runProjectsInOrder(runs, run) {
  let result = 0;
  for (const project of runs) {
    const code = await run(project);
    if (code === 130) return code;
    if (code !== 0 && result === 0) result = code;
  }
  return result;
}
if (import.meta.main)
  process.exitCode = await runProjectsInOrder(
    browserProjectRuns(process.argv.slice(2)),
    runProject,
  );
