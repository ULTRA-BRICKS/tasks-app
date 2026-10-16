/** PostgreSQL prevention acceptance reuses real HTTP cases in isolated synthetic schemas. */
if (!process.env.TEST_DATABASE_URL)
  throw Error(
    'TEST_DATABASE_URL must explicitly point at a coordinator-provided synthetic PostgreSQL server',
  );
await import('../unit/linear-comment-prevention.test.mjs');
