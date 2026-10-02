import { test, expect } from 'bun:test';
import { inspectReadiness } from '../../packages/server/readiness.mjs';
import { CURRENT_SCHEMA_VERSION } from '../../packages/db/index.mjs';
import { fixture } from './helpers.mjs';
test('readiness separates a live function from an initialized private workspace', async () => {
  const f = await fixture();
  try {
    const ready = await f.request('GET', '/api/ready', undefined, { anonymous: true });
    expect(ready.status).toBe(200);
    expect(ready.data).toEqual({ status: 'ready' });
    const a = await f.request('POST', '/graphql', { query: '{ viewer { id name } }' });
    const b = await f.request('POST', '/api/graphql', { query: '{ viewer { id name } }' });
    expect(b.status).toBe(a.status);
    expect(b.data).toEqual(a.data);
  } finally {
    await f.close();
  }
});
test('readiness never includes connection failures or database secrets', async () => {
  const result = await inspectReadiness({
    transaction: async () => {
      throw new Error('private connection string');
    },
  });
  expect(result).toEqual({ status: 'not_ready', code: 'DATABASE_SETUP_REQUIRED' });
});
test('readiness enforces exact migration sequence and presence of an owner', async () => {
  const db = (versions, owner) => ({
    transaction: async (fn, options) => {
      expect(options.readOnly).toBe(true);
      return fn({
        all: async () => versions.map((version) => ({ version })),
        one: async () => owner,
      });
    },
  });
  expect((await inspectReadiness(db([], null))).code).toBe('MIGRATION_REQUIRED');
  const versions = Array.from({ length: CURRENT_SCHEMA_VERSION }, (_, i) => i + 1);
  expect((await inspectReadiness(db(versions, null))).code).toBe('OWNER_SETUP_REQUIRED');
  expect((await inspectReadiness(db(versions, { user_id: 'private' }))).status).toBe('ready');
});

test('generated public REST contract documents readiness success and unavailable states', async () => {
  const { generateOpenAPI } = await import('../../scripts/openapi.mjs');
  const endpoint = generateOpenAPI().paths['/ready'].get;
  expect(endpoint.security).toEqual([]);
  expect(endpoint.responses[200].content['application/json'].schema.properties.status.const).toBe(
    'ready',
  );
  expect(endpoint.responses[503].content['application/json'].schema.properties.code.enum).toContain(
    'OWNER_SETUP_REQUIRED',
  );
});

test('real serverless entrypoint honors readiness shape without production configuration', async () => {
  const { createVercelHandler } = await import('../../api/index.mjs');
  const app = createVercelHandler({});
  const r = await app.fetch(new Request('https://example.test/api/ready'));
  expect(r.status).toBe(503);
  expect(await r.json()).toEqual({ status: 'not_ready', code: 'PRODUCTION_CONFIG_REQUIRED' });
  const ordinary = await app.fetch(new Request('https://example.test/api/v1/me'));
  expect(ordinary.status).toBe(503);
  expect((await ordinary.json()).error.code).toBe('NOT_CONFIGURED');
  const { generateOpenAPI } = await import('../../scripts/openapi.mjs');
  expect(
    generateOpenAPI().paths['/ready'].get.responses[503].content['application/json'].schema
      .properties.code.enum,
  ).toContain('PRODUCTION_CONFIG_REQUIRED');
});
