import { test, expect } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from './helpers.mjs';

async function staticFixture() {
  const root = await mkdtemp(join(tmpdir(), 'tasks-public-'));
  const publicDir = join(root, 'dist');
  await mkdir(join(publicDir, 'assets'), { recursive: true });
  await writeFile(join(publicDir, 'index.html'), '<!doctype html><title>Tasks</title>');
  await writeFile(join(publicDir, 'assets', 'test.js'), 'console.log("public")');
  await writeFile(join(root, 'private.txt'), 'private');
  await writeFile(join(publicDir, '.env'), 'private');
  await symlink(join(root, 'private.txt'), join(publicDir, 'leak.txt'));
  return { root, publicDir, close: () => rm(root, { recursive: true, force: true }) };
}
test('self-hosted HTTP serves code and UUID routes, retains API auth, and never serves unknown/private files', async () => {
  const { createPublicApp } = await import('../../packages/server/public-app.mjs');
  const files = await staticFixture();
  const f = await fixture();
  try {
    const publicApp = await createPublicApp(f.app, files.publicDir);
    for (const path of [
      '/',
      '/tasks/HYP-1482',
      '/issues/2ee4c325-5e25-5170-a0d2-e0c3322f2052',
      '/login',
    ]) {
      const r = await publicApp.fetch(new Request('https://tasks.example.test' + path));
      expect(r.status).toBe(200);
      expect(await r.text()).toContain('<title>Tasks</title>');
      expect(r.headers.get('cache-control')).toBe('no-store');
    }
    expect(
      (await publicApp.fetch(new Request('https://tasks.example.test/api/v1/me'))).status,
    ).toBe(401);
    expect(
      (await publicApp.fetch(new Request('https://tasks.example.test/api/unknown'))).status,
    ).toBe(404);
    for (const path of [
      '/assets/absent.js',
      '/.env',
      '/%2eenv',
      '/leak.txt',
      '/%2e%2e/private.txt',
      '/assets/test.js.map',
    ])
      expect((await publicApp.fetch(new Request('https://tasks.example.test' + path))).status).toBe(
        404,
      );
    const asset = await publicApp.fetch(new Request('https://tasks.example.test/assets/test.js'));
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');
    const head = await publicApp.fetch(
      new Request('https://tasks.example.test/tasks/HYP-1482', { method: 'HEAD' }),
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(
      (await publicApp.fetch(new Request('https://tasks.example.test/login', { method: 'POST' })))
        .status,
    ).toBe(405);
  } finally {
    await f.close();
    await files.close();
  }
});
test('self-hosted configuration requires an explicit writer, durable DB, HTTPS origin and stable auth secret', async () => {
  const { productionEnvironment } = await import('../../packages/server/production-runtime.mjs');
  const valid = {
    APP_URL: 'https://tasks.example.test',
    DATABASE_URL: 'postgres://fixture:fixture@db/tasks',
    AUTH_SECRET: 'fixture-only-'.repeat(4),
    TASKS_DEPLOYMENT_ID: 'k3s-fixture-1',
  };
  expect(productionEnvironment(valid).LINEAR_QUEUE_DRIVER).toBe('postgres');
  expect(productionEnvironment(valid).NODE_ENV).toBe('production');
  for (const key of ['APP_URL', 'DATABASE_URL', 'AUTH_SECRET', 'TASKS_DEPLOYMENT_ID'])
    expect(() => productionEnvironment({ ...valid, [key]: undefined })).toThrow();
  expect(() => productionEnvironment({ ...valid, APP_URL: 'http://tasks.example.test' })).toThrow();
  expect(() => productionEnvironment({ ...valid, VERCEL_DEPLOYMENT_ID: 'different' })).toThrow();
  expect(() => productionEnvironment({ ...valid, LINEAR_QUEUE_DRIVER: 'vercel' })).toThrow();
  const files = await staticFixture();
  try {
    const { createPublicApp } = await import('../../packages/server/public-app.mjs');
    await rm(join(files.publicDir, 'index.html'));
    await assert.rejects(
      createPublicApp({ fetch: () => new Response() }, files.publicDir),
      /index.html/,
    );
  } finally {
    await files.close();
  }
});
