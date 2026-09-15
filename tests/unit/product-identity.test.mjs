import { test, expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { fixture } from './helpers.mjs';

test('tasks-app branding and executable alias retain the legacy command', async () => {
  const config = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  expect(config.name).toBe('tasks-app');
  expect(config.repository.url).toBe('https://git.hyperide.ai/ultrabricks/tasks-app.git');
  expect(config.bin['tasks-app']).toBe(config.bin.tickets);
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  expect(html).toContain('<title>tasks-app</title>');
  const schema = JSON.parse(
    await readFile(new URL('../../docs/openapi.json', import.meta.url), 'utf8'),
  );
  expect(schema.info.title).toBe('tasks-app API');
  expect(schema.info.version).toBe(config.version);
});

test('renamed health service does not invalidate the established session and CSRF contract', async () => {
  const f = await fixture();
  try {
    const health = await f.request('GET', '/api/health', undefined, { anonymous: true });
    expect(health.data.service).toBe('tasks-app');
    const config = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    );
    expect(health.data.version).toBe(config.version);
    expect(f.session.startsWith('tickets_session=')).toBe(true);
    expect((await f.request('GET', '/api/v1/me')).status).toBe(200);
    expect((await f.create({ title: 'Compatible creation after rename' })).status).toBe(201);
  } finally {
    await f.close();
  }
});
