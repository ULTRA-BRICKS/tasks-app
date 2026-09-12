import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { POSTGRES_POOL_OPTIONS } from '../../packages/db/index.mjs';

test('pool acquisition reserves at least half of the deployed request budget for execution', () => {
  const deployment = JSON.parse(
    readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'),
  );
  const deadline = deployment.functions['api/index.mjs'].maxDuration * 1000;
  expect(POSTGRES_POOL_OPTIONS.connectionTimeoutMillis).toBeGreaterThan(0);
  expect(POSTGRES_POOL_OPTIONS.connectionTimeoutMillis).toBeLessThanOrEqual(deadline / 2);
  expect(POSTGRES_POOL_OPTIONS.max).toBe(4);
  expect(Object.isFrozen(POSTGRES_POOL_OPTIONS)).toBe(true);
});
