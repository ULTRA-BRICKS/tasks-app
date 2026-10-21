/** Real PostgreSQL parity for signed source team moves; never fall back to SQLite. */
if (!process.env.TEST_DATABASE_URL)
  throw Error('TEST_DATABASE_URL must select synthetic PostgreSQL');
await import('../unit/linear-signed-team-move.test.mjs');
