import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));

test('the account-mail schedule is deployable on the existing daily-cron plan', () => {
  expect(config.crons).toEqual([
    { path: '/api/internal/account-email', schedule: '0 0 * * *' },
    { path: '/api/internal/linear-sync', schedule: '30 4 * * *' },
  ]);
  expect(config.functions['api/index.mjs'].maxDuration).toBe(60);
});
