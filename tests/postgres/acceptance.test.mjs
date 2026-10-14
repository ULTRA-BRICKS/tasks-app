import { test, expect } from 'bun:test';
import { fixture } from '../unit/helpers.mjs';
if (!process.env.TEST_DATABASE_URL)
  throw new Error('TEST_DATABASE_URL must explicitly point at an isolated test server');
// Run exactly the same API, authorization, GraphQL and integration cases on real Postgres.
await import('../unit/core.test.mjs');
await import('../unit/policy.test.mjs');
await import('../unit/planning-inline.test.mjs');
await import('../unit/readiness.test.mjs');
await import('../unit/regressions.test.mjs');
await import('../unit/linear.test.mjs');
await import('../unit/transport.test.mjs');
await import('../unit/slack-notifications.test.mjs');
await import('../unit/slack-delivery.test.mjs');
await import('../unit/slack-followup.test.mjs');
await import('../unit/slack-review-fixes.test.mjs');
await import('../unit/slack-profiles.test.mjs');
await import('../unit/mcp.test.mjs');
test('PostgreSQL acceptance cannot silently use SQLite', async () => {
  const f = await fixture();
  try {
    expect(f.db.dialect).toBe('postgres');
  } finally {
    await f.close();
  }
});
