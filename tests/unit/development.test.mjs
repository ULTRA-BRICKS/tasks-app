import { test, expect } from 'bun:test';
import {
  resolveDevelopment,
  applicationOrigin,
  isAllowedOrigin,
} from '../../packages/config/development.mjs';
import {
  setupOptions,
  buildLocalEnvironment,
  writeLocalEnvironment,
} from '../../scripts/setup-config.mjs';
import { mkdtemp, stat, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('API default is 8888 and proxy shares its resolved value', () => {
  expect(resolveDevelopment().apiTarget).toBe('http://127.0.0.1:8888');
  expect(resolveDevelopment({ API_PORT: '9001' }).apiTarget).toBe('http://127.0.0.1:9001');
});
for (const value of ['0', '-1', '65536', 'NaN', '8888x', '4.2', ' 80 '])
  test(`reject invalid API port ${value}`, () =>
    expect(() => resolveDevelopment({ API_PORT: value })).toThrow());
test('port collisions are explicit', () =>
  expect(() => resolveDevelopment({ API_PORT: '5173' })).toThrow('differ'));
test('development localhost aliases do not relax production origin checks', () => {
  expect(isAllowedOrigin('http://127.0.0.1:5173')).toBe(true);
  for (const v of [
    'http://localhost.attacker.test:5173',
    'http://localhost:8888',
    'https://localhost:5173',
    'null',
  ])
    expect(isAllowedOrigin(v)).toBe(false);
  const env = { NODE_ENV: 'production', APP_URL: 'https://localhost:5173' };
  expect(isAllowedOrigin('https://127.0.0.1:5173', env)).toBe(false);
  expect(isAllowedOrigin('https://localhost:5173', env)).toBe(true);
  expect(() => applicationOrigin({ NODE_ENV: 'production' })).toThrow('APP_URL');
});
for (const args of [['--port'], ['--port', 'oops'], ['--port', ''], ['--unknown']])
  test(`setup validates args ${args.join(' ')}`, () => expect(() => setupOptions(args)).toThrow());
test('setup persists explicit port and is repeatable without rotating secrets', async () => {
  const options = setupOptions(['--demo', '--port', '9002']);
  const first = buildLocalEnvironment('# keep\nCUSTOM="hello world"\nAUTH_SECRET=\n', options);
  expect(first.env.API_PORT).toBe('9002');
  expect(first.env.AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
  expect(buildLocalEnvironment(first.text, options).text).toBe(first.text);
  const dir = await mkdtemp(join(tmpdir(), 'tickets-setup-'));
  try {
    const file = join(dir, '.env.local');
    await writeLocalEnvironment(file, first.text);
    expect(await readFile(file, 'utf8')).toBe(first.text);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('cloud demo refusal occurs before file writes', () => {
  for (const env of [
    { DATABASE_URL: 'postgres://invalid/db' },
    { DATABASE_URL_UNPOOLED: 'postgres://invalid/db' },
    { NODE_ENV: 'production' },
    { VERCEL: '1' },
  ])
    expect(() => buildLocalEnvironment('', { demo: true }, env)).toThrow('local-only');
});
test('web port updates local origin but preserves explicit domains', () => {
  expect(
    buildLocalEnvironment('APP_URL=http://localhost:5173', { 'web-port': '9003' }).env.APP_URL,
  ).toBe('http://localhost:9003');
  expect(
    buildLocalEnvironment('APP_URL=https://tickets.example', { 'web-port': '9003' }).env.APP_URL,
  ).toBe('https://tickets.example');
});

test('bind addresses and origin-shaped values are validated', () => {
  expect(resolveDevelopment({ API_HOST: '0.0.0.0' }).apiTarget).toBe('http://127.0.0.1:8888');
  expect(resolveDevelopment({ API_HOST: '::' }).apiTarget).toBe('http://[::1]:8888');
  expect(() => resolveDevelopment({ API_HOST: 'attacker.example' })).toThrow();
  for (const url of [
    'http://user@localhost:5173',
    'http://localhost:5173/path',
    'http://localhost:5173?x=1',
  ])
    expect(() => applicationOrigin({ APP_URL: url })).toThrow();
  expect(resolveDevelopment({ API_PORT: '1' }).apiPort).toBe(1);
  expect(resolveDevelopment({ API_PORT: '65535' }).apiPort).toBe(65535);
});

test('setup preserves literal path backslashes and quote characters over repeat runs', () => {
  for (const path of [
    String.raw`.data/team\archive.sqlite`,
    '.data/a"b.sqlite',
    ".data/a'b.sqlite",
  ]) {
    const input = 'SQLITE_PATH=' + path + '\n';
    const first = buildLocalEnvironment(input);
    const second = buildLocalEnvironment(first.text);
    expect(first.env.SQLITE_PATH).toBe(path);
    expect(second.env.SQLITE_PATH).toBe(path);
    expect(second.text).toBe(first.text);
  }
});

test('setup does not rewrite key-shaped text inside a multiline custom value', () => {
  const source = 'CUSTOM="first\nAPI_PORT=9000\nlast"\n';
  const first = buildLocalEnvironment(source, { port: '9002' });
  expect(first.env.CUSTOM).toBe('first\nAPI_PORT=9000\nlast');
  expect(first.env.API_PORT).toBe('9002');
  expect(buildLocalEnvironment(first.text).text).toBe(first.text);
});

test('setup preserves backtick multiline values and validates its serialized result', () => {
  const source = 'CUSTOM=`first\nAPI_PORT=9000\nlast`\n';
  const result = buildLocalEnvironment(source, { port: '9002' });
  expect(result.env.CUSTOM).toBe('first\nAPI_PORT=9000\nlast');
  expect(result.env.API_PORT).toBe('9002');
  expect(buildLocalEnvironment(result.text).text).toBe(result.text);
});
