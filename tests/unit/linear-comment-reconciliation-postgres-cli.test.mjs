/** Operator selection and transaction contracts; doubles never establish real PostgreSQL acceptance. */
import { test, expect } from 'bun:test';
import assert from 'node:assert/strict';
import { runLocalCommentReconciliation } from '../../scripts/reconcile-linear-comments.mjs';

const args = [
  '--postgres-env',
  'REPAIR_TEST_URL',
  '--workspace',
  crypto.randomUUID(),
  '--actor',
  crypto.randomUUID(),
  '--source',
  crypto.randomUUID(),
  '--comment',
  crypto.randomUUID(),
];
const url = 'postgresql://synthetic:private@localhost/synthetic';
function harness({ role = 'owner', fail = false } = {}) {
  const calls = [];
  const tx = {
    dialect: 'postgres',
    one: async (sql) => {
      calls.push(sql);
      if (fail) throw Error(url);
      if (sql === 'SHOW transaction_isolation') return { transaction_isolation: 'read committed' };
      if (sql.includes('FROM memberships')) return role ? { role } : null;
      if (sql.includes('FROM module_settings')) return { enabled: 1 };
      if (sql.includes('COUNT(*)')) return { count: '0', bytes: '0' };
      return null;
    },
    all: async () => [],
    exec: async (sql) => {
      calls.push(sql);
      if (sql !== 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED') throw Error('Unexpected write');
      return { changes: 0 };
    },
    lock: async () => {
      calls.push('lock');
    },
  };
  return {
    calls,
    options: {
      env: { REPAIR_TEST_URL: url },
      openDatabase: async (options) => {
        calls.push(options);
        return {
          transaction: async (fn, options) => {
            calls.push(options);
            return fn(tx);
          },
          close: async () => {
            calls.push('closed');
          },
        };
      },
    },
  };
}
test('PostgreSQL preview selects only the named environment URL and requests readOnly transaction', async () => {
  const h = harness();
  const result = await runLocalCommentReconciliation(args, h.options);
  expect(result.applied).toBe(false);
  expect(h.calls[0]).toEqual({ url, production: true });
  expect(h.calls[1]).toEqual({ readOnly: true });
  expect(h.calls).not.toContain('lock');
  expect(h.calls.at(-1)).toBe('closed');
});
test('PostgreSQL apply requests write transaction and validates the actual plan', async () => {
  const h = harness();
  await assert.rejects(
    runLocalCommentReconciliation([...args, '--apply-plan', '0'.repeat(64)], h.options),
    { code: 'PLAN_CHANGED' },
  );
  expect(h.calls[1]).toEqual({ readOnly: false });
  expect(h.calls).toContain('lock');
  expect(h.calls[2]).toBe('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
  expect(h.calls.indexOf('lock')).toBeLessThan(
    h.calls.findIndex((sql) => typeof sql === 'string' && sql.includes('FROM memberships')),
  );
  expect(h.calls.at(-1)).toBe('closed');
});
test('operator rejects mixed modes, credential arguments and invalid or missing environment selection before opening', async () => {
  const h = harness();
  for (const input of [
    [...args, '--sqlite', '/tmp/unused.sqlite'],
    [...args, '--postgres-env', 'OTHER'],
    ['--postgres-env', url, ...args.slice(2)],
    ['--postgres-env', 'UNSET', ...args.slice(2)],
    [...args, '--database-url', url],
    [...args, '--apply-plan', 'invalid'],
  ])
    await assert.rejects(runLocalCommentReconciliation(input, h.options));
  expect(h.calls).toEqual([]);
});
test('PostgreSQL rejects non-PostgreSQL URLs without fallback or secret disclosure', async () => {
  const h = harness();
  h.options.env.REPAIR_TEST_URL = 'file:///private/credential';
  await assert.rejects(runLocalCommentReconciliation(args, h.options), /PostgreSQL URL/);
  expect(h.calls).toEqual([]);
});
for (const role of ['', 'member', 'viewer'])
  test(`actual membership rejects ${role || 'absent'} actor`, async () => {
    const h = harness({ role });
    await assert.rejects(
      runLocalCommentReconciliation(args, h.options),
      role ? { code: 'FORBIDDEN' } : /no membership/,
    );
    expect(h.calls.at(-1)).toBe('closed');
  });
test('PostgreSQL query failures close the pool and redact driver messages', async () => {
  const h = harness({ fail: true });
  await assert.rejects(runLocalCommentReconciliation(args, h.options), (error) => {
    expect(error.message).not.toContain(url);
    expect(error.message).toContain('PostgreSQL');
    return true;
  });
  expect(h.calls.at(-1)).toBe('closed');
});
