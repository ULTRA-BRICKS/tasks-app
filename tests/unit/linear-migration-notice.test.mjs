import { test, expect } from 'bun:test';
import {
  createMigrationNotice,
  readMigrationNotice,
  retainMigrationNotice,
} from '../../packages/server/modules/linear-live/migration-notice.mjs';
const context = {
  appOrigin: 'https://tasks-ultrabricks.vercel.app',
  organizationId: 'b16c196e-0f55-4143-94b1-20565df6a468',
  sourceId: '56182b8b-8ba2-4d85-a937-d416eba866d4',
  targetId: '2ee4c325-5e25-5170-a0d2-e0c3322f2052',
  code: 'HYP-1482',
  secret: 'synthetic-local-test-secret',
};
const body =
  '## Actual task\n\n> Preserve this user quote.\n\n- [ ] This checkbox is not migration metadata.\n\n---\n\n```md\n> Managed elsewhere\n```\n';
test('managed migration notice links by code and strips without changing any business-body bytes', () => {
  const text = createMigrationNotice(body, context);
  expect(text).toContain('/tasks/HYP-1482');
  expect(text).not.toContain(context.secret);
  const parsed = readMigrationNotice(text, context);
  expect(parsed.body).toBe(body);
  expect(parsed.notice.targetId).toBe(context.targetId);
  expect(parsed.notice.sourceId).toBe(context.sourceId);
  expect(parsed.notice.code).toBe(context.code);
});
test('ordinary Tasks links and user quotes are never removed as managed metadata', () => {
  for (const input of [
    body,
    '> **Managed in Tasks-app** — [HYP-1482](https://tasks-ultrabricks.vercel.app/tasks/HYP-1482)\n\nReal text',
    'See https://tasks-ultrabricks.vercel.app/tasks/HYP-1482',
  ]) {
    expect(readMigrationNotice(input, context)).toEqual({ body: input, notice: null });
  }
});
test('forged, foreign and duplicated metadata fail closed rather than deleting user text', () => {
  const marked = createMigrationNotice(body, context);
  expect(() =>
    readMigrationNotice(marked, { ...context, sourceId: crypto.randomUUID() }),
  ).toThrow();
  expect(() =>
    readMigrationNotice(marked, { ...context, targetId: crypto.randomUUID() }),
  ).toThrow();
  expect(() =>
    readMigrationNotice(marked, { ...context, organizationId: crypto.randomUUID() }),
  ).toThrow();
  expect(() => readMigrationNotice(marked, { ...context, secret: 'wrong' })).toThrow();
  expect(() =>
    readMigrationNotice(
      marked.replace('Continue work in Tasks-app.', 'A user changed this paragraph.'),
      context,
    ),
  ).toThrow();
  expect(() => readMigrationNotice(createMigrationNotice(marked, context), context)).toThrow();
});
test('an outbound edit retains exactly one notice, and renumbering only replaces its link', () => {
  const marked = createMigrationNotice(body, context);
  const next = retainMigrationNotice('New body with a genuine edit', marked, context);
  expect(readMigrationNotice(next, context).body).toBe('New body with a genuine edit');
  const renamed = retainMigrationNotice(body, marked, { ...context, code: 'HYP-1500' });
  expect(readMigrationNotice(renamed, { ...context, code: 'HYP-1500' }).notice.code).toBe(
    'HYP-1500',
  );
  expect(renamed.match(/Managed in Tasks-app/g)).toHaveLength(1);
});
test('Linear-style angle-bracket URLs and CRLF formatting do not invalidate a genuine notice', () => {
  const marked = createMigrationNotice(body, context);
  const linearStyle = marked.replace(/\]\((https:[^)]+)\)/g, '](<$1>)');
  expect(readMigrationNotice(linearStyle, context).body).toBe(body);
  const crlf = marked.replaceAll('\n', '\r\n');
  expect(readMigrationNotice(crlf, context).body).toBe(body.replaceAll('\n', '\r\n'));
});
test('an unknown normal body needs no signing configuration and no marked body is silently accepted without it', () => {
  expect(readMigrationNotice(body, {})).toEqual({ body, notice: null });
  expect(() => readMigrationNotice(createMigrationNotice(body, context), {})).toThrow();
});

test('source transport strips only the managed description block and keeps real fields from the same event', async () => {
  const { requestLinear } = await import('../../packages/server/modules/linear-live/client.mjs');
  const expected = {
    id: context.sourceId,
    identifier: context.code,
    title: 'Real title update',
    priority: 1,
    description: createMigrationNotice(body, context),
  };
  const env = {
    LINEAR_API_TOKEN: 'synthetic',
    LINEAR_WEBHOOK_SECRET: context.secret,
    APP_URL: context.appOrigin,
  };
  const result = await requestLinear(
    env,
    'query { issue { id description priority } }',
    {},
    {
      verifyMigrationNotices: async (rows) => {
        expect(rows[0].notice.targetId).toBe(context.targetId);
        expect(rows[0].record.identifier).toBe(context.code);
      },
      fetcher: async () => Response.json({ data: { issue: expected } }),
    },
  );
  expect(result.issue.description).toBe(body);
  expect(result.issue.priority).toBe(1);
  expect(result.issue.title).toBe(expected.title);
  expect(result.issue._migrationNotice.targetId).toBe(context.targetId);
});

test('a source description write reattaches the verified managed notice without changing other mutation fields', async () => {
  const { requestLinear } = await import('../../packages/server/modules/linear-live/client.mjs');
  const notice = readMigrationNotice(createMigrationNotice(body, context), context).notice;
  const env = {
    LINEAR_API_TOKEN: 'synthetic',
    LINEAR_WEBHOOK_SECRET: context.secret,
    APP_URL: context.appOrigin,
  };
  let sent;
  const result = await requestLinear(
    env,
    'mutation { issueUpdate }',
    { id: context.sourceId, input: { description: 'Genuine edit', priority: 2 } },
    {
      migrationNotice: notice,
      verifyMigrationNotices: async (rows) => {
        expect(rows[0].notice.organizationId).toBe(context.organizationId);
        expect(rows[0].notice.targetId).toBe(context.targetId);
      },
      fetcher: async (_url, options) => {
        sent = JSON.parse(options.body).variables.input;
        return Response.json({
          data: {
            issueUpdate: {
              success: true,
              issue: {
                id: context.sourceId,
                identifier: context.code,
                description: sent.description,
                priority: sent.priority,
              },
            },
          },
        });
      },
    },
  );
  expect(readMigrationNotice(sent.description, context).body).toBe('Genuine edit');
  expect(sent.description).toContain('Managed in Tasks-app');
  expect(sent.priority).toBe(2);
  expect(result.issueUpdate.issue.description).toBe('Genuine edit');
});

test('an edited managed heading is not imported into the business body as an ordinary quote', () => {
  const changed = createMigrationNotice(body, context).replace(
    'Managed in Tasks-app',
    'Moved to Tasks-app',
  );
  expect(() => readMigrationNotice(changed, context)).toThrow();
});

test('paged issue reads await validation of all marked identities before exposing a stripped page', async () => {
  const { requestLinear } = await import('../../packages/server/modules/linear-live/client.mjs');
  const one = {
    id: context.sourceId,
    identifier: context.code,
    description: createMigrationNotice(body, context),
  };
  const twoContext = {
    ...context,
    sourceId: crypto.randomUUID(),
    targetId: crypto.randomUUID(),
    code: 'HYP-1490',
  };
  const two = {
    id: twoContext.sourceId,
    identifier: twoContext.code,
    description: createMigrationNotice('Second body', twoContext),
  };
  const env = {
    LINEAR_API_TOKEN: 'synthetic',
    LINEAR_WEBHOOK_SECRET: context.secret,
    APP_URL: context.appOrigin,
  };
  let checked = 0;
  const result = await requestLinear(
    env,
    'query IssuePage { issues { nodes { id identifier description } } }',
    {},
    {
      verifyMigrationNotices: async (entries) => {
        checked = entries.length;
        expect(entries[1].notice.targetId).toBe(twoContext.targetId);
      },
      fetcher: async () =>
        Response.json({
          data: { issues: { nodes: [one, two], pageInfo: { hasNextPage: false } } },
        }),
    },
  );
  expect(checked).toBe(2);
  expect(result.issues.nodes.map((r) => r.description)).toEqual([body, 'Second body']);
});
