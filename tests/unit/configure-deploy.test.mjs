import { test, expect } from 'bun:test';
import assert from 'node:assert/strict';
import {
  configure,
  planConfiguration,
  validateLink,
  TEAM_ID,
  REPOSITORY,
} from '../../scripts/configure-deploy.mjs';
const link = { projectId: 'prj_Test123', orgId: TEAM_ID, projectName: 'tickets-app' };
for (const [label, value] of Object.entries({
  null: null,
  array: [],
  missing: {},
  wrongId: { ...link, projectId: 'bad' },
  wrongTeam: { ...link, orgId: 'team_other' },
  wrongName: { ...link, projectName: 'other' },
})) {
  test(`deployment link rejects ${label}`, () => expect(() => validateLink(value)).toThrow());
}
test('valid project IDs produce exactly the two non-secret variables', () =>
  expect(validateLink(link)).toEqual({ VERCEL_ORG_ID: TEAM_ID, VERCEL_PROJECT_ID: 'prj_Test123' }));
test('a missing token is prompted for, never passed as an argument', () => {
  const plan = planConfiguration(link);
  expect(plan).toHaveLength(3);
  expect(plan[2]).toEqual(['gh', 'secret', 'set', 'VERCEL_TOKEN', '--repo', REPOSITORY]);
});
test('existing matching configuration is a no-op', () =>
  expect(
    planConfiguration(
      link,
      Object.entries(validateLink(link)).map(([name, value]) => ({ name, value })),
      [{ name: 'VERCEL_TOKEN' }],
    ),
  ).toEqual([]));
test('conflicting target is not overwritten', () =>
  expect(() =>
    planConfiguration(link, [{ name: 'VERCEL_PROJECT_ID', value: 'prj_Other' }]),
  ).toThrow('refusing to overwrite'));
test('unreadable legacy secret cannot shadow a new variable', () =>
  expect(() => planConfiguration(link, [], [{ name: 'VERCEL_PROJECT_ID' }])).toThrow(
    'Legacy secret',
  ));
test('default mode makes zero external calls', async () => {
  let calls = 0;
  const result = await configure({
    link,
    run: async () => {
      calls++;
      return '';
    },
  });
  expect(result.applied).toBe(false);
  expect(calls).toBe(0);
});
function runner({ variables = [], secrets = [], failName } = {}) {
  const writes = [];
  return {
    writes,
    run: async (args, options) => {
      if (args[1] === 'auth') return '';
      if (args[1] === 'repo') return REPOSITORY;
      if (args[2] === 'list') return JSON.stringify(args[1] === 'variable' ? variables : secrets);
      if (args[3] === failName) throw new Error('permission denied');
      writes.push({ args, options });
      return '';
    },
  };
}
test('missing TTY stops before any writes', async () => {
  const r = runner();
  await assert.rejects(() => configure({ link, apply: true, run: r.run }), /terminal/);
  expect(r.writes).toEqual([]);
});
test('apply writes missing values and delegates hidden input to gh', async () => {
  const r = runner();
  const result = await configure({ link, apply: true, tty: true, run: r.run });
  expect(result.completed).toEqual(['VERCEL_ORG_ID', 'VERCEL_PROJECT_ID', 'VERCEL_TOKEN']);
  expect(r.writes[2].options.interactive).toBe(true);
});
test('existing token is not rotated', async () => {
  const r = runner({ secrets: [{ name: 'VERCEL_TOKEN' }] });
  await configure({ link, apply: true, run: r.run });
  expect(r.writes).toHaveLength(2);
  expect(r.writes.every((x) => x.args[1] === 'variable')).toBe(true);
});
test('remote write failure stops the sequence', async () => {
  const r = runner({ failName: 'VERCEL_PROJECT_ID' });
  await assert.rejects(
    () => configure({ link, apply: true, tty: true, run: r.run }),
    /permission denied/,
  );
  expect(r.writes).toHaveLength(1);
});
