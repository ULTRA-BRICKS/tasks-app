import { test, expect } from 'bun:test';
import { resolve } from 'node:path';
import { browserProjectRuns, runProjectsInOrder } from '../../scripts/test-e2e.mjs';

test('each browser runs alone and retains independent result and HTML directories', () => {
  const runs = browserProjectRuns([], {});
  expect(runs.map((run) => run.project)).toEqual(['chromium', 'webkit']);
  for (const run of runs) {
    expect(run.args.filter((arg) => arg.startsWith('--project='))).toEqual([
      `--project=${run.project}`,
    ]);
    expect(run.args.at(-1)).toBe(`--output=${resolve('test-results', run.project)}`);
    expect(run.env.PLAYWRIGHT_HTML_OUTPUT_DIR).toBe(resolve('playwright-report', run.project));
  }
});
test('file and grep filters reach both browsers while custom artifact roots stay separate', () => {
  const env = { API_PORT: '18888', PLAYWRIGHT_HTML_OUTPUT_DIR: '/tmp/tasks-proof/html' };
  const runs = browserProjectRuns(
    ['inline-calendar.spec.ts', '--grep', 'date', '--output', '/tmp/tasks-proof/results'],
    env,
  );
  for (const run of runs) {
    const forwarded = run.args.indexOf('inline-calendar.spec.ts');
    expect(forwarded).toBeGreaterThan(-1);
    expect(run.args.slice(forwarded, forwarded + 3)).toEqual([
      'inline-calendar.spec.ts',
      '--grep',
      'date',
    ]);
    expect(run.args).not.toContain('--output');
    expect(run.args.at(-1)).toBe(`--output=/tmp/tasks-proof/results/${run.project}`);
    expect(run.env.API_PORT).toBe('18888');
    expect(run.env.PLAYWRIGHT_HTML_OUTPUT_DIR).toBe(`/tmp/tasks-proof/html/${run.project}`);
  }
  expect(env.PLAYWRIGHT_HTML_OUTPUT_DIR).toBe('/tmp/tasks-proof/html');
});
test('invalid artifact output arguments fail instead of silently consuming a test option', () => {
  expect(() => browserProjectRuns(['--output'], {})).toThrow('--output requires a directory');
  expect(() => browserProjectRuns(['--output='], {})).toThrow('--output requires a directory');
  for (const args of [['--output', '--grep'], ['--output=--grep']])
    expect(() => browserProjectRuns(args, {})).toThrow('--output requires a directory');
});
test('an explicit project selects one isolated run rather than adding it to both runs', () => {
  expect(browserProjectRuns(['--project=webkit'], {}).map((run) => run.project)).toEqual([
    'webkit',
  ]);
  expect(browserProjectRuns(['--project', 'chromium'], {}).map((run) => run.project)).toEqual([
    'chromium',
  ]);
  expect(() => browserProjectRuns(['--project=visual'], {})).toThrow('Use test:visual');
  expect(() => browserProjectRuns(['--project=firefox'], {})).toThrow(
    /^Unsupported project firefox; use chromium or webkit\.$/,
  );
});
test('a missing project name fails as a usage error instead of swallowing the next option', () => {
  for (const args of [['--project'], ['--project', '--grep'], ['--project=']])
    expect(() => browserProjectRuns(args, {})).toThrow('--project requires chromium or webkit');
});
test('a failing browser still lets the next browser report, while an interruption stops the run', async () => {
  const runs = browserProjectRuns([], {});
  const started = [];
  const codes = { chromium: 1, webkit: 0 };
  expect(
    await runProjectsInOrder(runs, async (run) => {
      started.push(run.project);
      return codes[run.project];
    }),
  ).toBe(1);
  expect(started).toEqual(['chromium', 'webkit']);
  started.length = 0;
  codes.chromium = 130;
  expect(
    await runProjectsInOrder(runs, async (run) => {
      started.push(run.project);
      return codes[run.project];
    }),
  ).toBe(130);
  expect(started).toEqual(['chromium']);
  codes.chromium = 0;
  codes.webkit = 2;
  expect(await runProjectsInOrder(runs, async (run) => codes[run.project])).toBe(2);
});
