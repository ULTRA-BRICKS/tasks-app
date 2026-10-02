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
