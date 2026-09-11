import { test, expect } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  setupOptions,
  buildLocalEnvironment,
  writeLocalEnvironment,
} from '../../scripts/setup-config.mjs';
import { initializeLocalDemo } from '../../scripts/demo-setup.mjs';
import { createDatabase } from '../../packages/db/index.mjs';

test('setup persists explicit API port, derived defaults, and private secrets', async () => {
  const options = setupOptions(['--', '--demo', '--port', '9123']);
  const result = buildLocalEnvironment(
    'NODE_ENV=development\nAUTH_SECRET=\nCRON_SECRET=\n',
    options,
  );
  expect(result.env.API_PORT).toBe('9123');
  expect(result.env.AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
  expect(result.env.APP_URL).toBe('http://localhost:5173');
  const dir = await mkdtemp(join(tmpdir(), 'tickets-env-'));
  try {
    const file = join(dir, '.env.local');
    await writeLocalEnvironment(file, result.text);
    expect(await readFile(file, 'utf8')).toBe(result.text);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('default port is 8888; empty template does not override shell', () => {
  expect(buildLocalEnvironment('API_PORT=\n').env.API_PORT).toBe('8888');
  expect(buildLocalEnvironment('API_PORT=\n', {}, { API_PORT: '8899' }).env.API_PORT).toBe('8899');
});
test('setup is stable and preserves unrelated comments, quoted keys and secrets', () => {
  const first = buildLocalEnvironment(
    '# custom\nCUSTOM="hello world"\nAUTH_SECRET=keep-me\nAPI_PORT="9111"\n',
  ).text;
  const second = buildLocalEnvironment(first).text;
  expect(second).toBe(first);
  expect(second).toContain('# custom\nCUSTOM="hello world"');
  expect(second).toContain('AUTH_SECRET=keep-me');
});
test('CLI override wins but does not erase other port; web origin follows explicit web port', () => {
  const result = buildLocalEnvironment(
    'API_PORT=8000\nWEB_PORT=8001\nAPP_URL=http://localhost:8001\n',
    { port: '9000', 'web-port': '9001' },
    { API_PORT: '8002' },
  );
  expect(result.env.API_PORT).toBe('9000');
  expect(result.env.APP_URL).toBe('http://localhost:9001');
});
for (const args of [['--port'], ['--port', 'NaN'], ['--port', '65536'], ['--reset'], ['--typo']])
  test(`setup rejects ${args.join(' ')} before any write`, () =>
    expect(() => setupOptions(args)).toThrow());
for (const [text, shell] of [
  ['DATABASE_URL="postgresql://example.invalid/db"', {}],
  ['NODE_ENV="production"', {}],
  ['', { DATABASE_URL: 'postgresql://example.invalid/db' }],
  ['', { VERCEL: '1' }],
  ['DATABASE_URL_UNPOOLED=postgresql://example.invalid/db', {}],
])
  test('demo refuses real database configuration', () =>
    expect(() => buildLocalEnvironment(text, { demo: true }, shell)).toThrow('refuses'));
test('a repeated demo setup does not delete or overwrite data', async () => {
  const db = await createDatabase({ sqlitePath: ':memory:' });
  try {
    expect((await initializeLocalDemo(db)).status).toBe('created');
    await db.transaction((tx) =>
      tx.exec("UPDATE issues SET title='My edited issue' WHERE number=1"),
    );
    const before = await db.transaction((tx) => tx.all('SELECT * FROM users ORDER BY id'));
    expect((await initializeLocalDemo(db)).status).toBe('existing');
    expect(await db.transaction((tx) => tx.all('SELECT * FROM users ORDER BY id'))).toEqual(before);
    expect(
      (await db.transaction((tx) => tx.one('SELECT title FROM issues WHERE number=1'))).title,
    ).toBe('My edited issue');
  } finally {
    await db.close();
  }
});

test('setup updates indented exported variables without creating a duplicate', () => {
  const result = buildLocalEnvironment('  export API_PORT = 8999\n', { port: '8888' }, {});
  expect(result.text.match(/API_PORT/g)).toHaveLength(1);
  expect(result.env.API_PORT).toBe('8888');
});

test('CLI port validation uses the final environment before checking collisions', () => {
  const options = setupOptions(['--port', '5173']);
  const result = buildLocalEnvironment('WEB_PORT=5174\n', options);
  expect(result.config.apiPort).toBe(5173);
  expect(result.config.webPort).toBe(5174);
  expect(() => buildLocalEnvironment('', options)).toThrow('different');
});
