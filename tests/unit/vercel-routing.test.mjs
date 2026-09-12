import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fixture } from './helpers.mjs';
const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));

test('Vercel catch-all routing must not synthesize named API query parameters', () => {
  // Unused named captures are appended to the destination query by Vercel.
  // The application dispatches by original pathname and needs no captured parameter.
  expect(config.rewrites).toEqual([
    { source: '/graphql', destination: '/api/index' },
    { source: '/api', destination: '/api/index' },
    { source: '/api/(.*)', destination: '/api/index' },
    { source: '/(.*)', destination: '/index.html' },
  ]);
});

test('API catch-all precedes SPA routing without claiming similarly named pages', () => {
  const route = (path) =>
    config.rewrites.find((rule) => new RegExp('^' + rule.source + '$').test(path));
  for (const path of [
    '/api',
    '/api/',
    '/api/v1/issues',
    '/api/v1/issues/TKT-1',
    '/api/v1/attachments/file/content',
    '/api/ready',
    '/api/graphql',
  ])
    expect(route(path)?.destination).toBe('/api/index');
  expect(route('/graphql')?.destination).toBe('/api/index');
  for (const path of ['/issues/new', '/api-docs', '/projects/project'])
    expect(route(path)?.destination).toBe('/index.html');
});

test('issue query contract preserves filters and still rejects client-supplied path', async () => {
  const f = await fixture();
  try {
    await f.create({ title: 'Routing regression target' });
    const listed = await f.request('GET', '/api/v1/issues?limit=1&q=Routing%20regression%20target');
    expect(listed.status).toBe(200);
    expect(listed.data.data).toHaveLength(1);
    expect(listed.data.data[0].title).toBe('Routing regression target');
    const invalid = await f.request('GET', '/api/v1/issues?path=v1/issues');
    expect(invalid.status).toBe(422);
    expect(invalid.data.error.code).toBe('VALIDATION_ERROR');
    expect(
      (await f.request('GET', '/api/v1/issues?limit=100', undefined, { anonymous: true })).status,
    ).toBe(401);
  } finally {
    await f.close();
  }
});
