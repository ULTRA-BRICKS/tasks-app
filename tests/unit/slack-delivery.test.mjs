// Synthetic adversarial delivery cases use real mutations/database; only the network boundary is replaced.
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { createHash } from 'node:crypto';
import { createApplication } from '../../api/index.mjs';
import { createIssue } from '../../packages/server/modules/tickets/service.mjs';
import {
  runSlackDelivery,
  dispatchSlackNotifications,
  processSlackMessage,
  withSlackWake,
} from '../../packages/server/modules/integrations/slack-delivery.mjs';

async function setup(appOptions = {}) {
  const f = await fixture(
    {
      SLACK_BOT_TOKEN: 'test-token',
      SLACK_CHANNEL_ID: 'C123',
      CRON_SECRET: 'cron-test',
    },
    { sqlitePath: ':memory:' },
    appOptions,
  );
  f.env.INTEGRATIONS_WORKSPACE_ID = f.init.workspace_id;
  await f.request('PATCH', '/api/v1/integrations/slack', {
    team_id: f.init.team_id,
    user_map: {},
    notify: true,
  });
  return f;
}
const rows = (f) =>
  f.db.transaction((tx) =>
    tx.all(
      "SELECT * FROM outbox WHERE provider='slack' AND status NOT IN ('state','lease') ORDER BY created_at,id",
    ),
  );
const receipt = async () => Response.json({ ok: true, channel: 'C123', ts: '1234567890.123456' });

test('synthetic: authenticated HTTP scheduled recovery persists receipts after a lost queue publication', async () => {
  let calls = 0;
  const f = await setup({
    slackFetch: async () => {
      calls++;
      return receipt();
    },
  });
  try {
    await f.create();
    await assert.rejects(
      dispatchSlackNotifications(f.db, f.env, {
        send: async () => {
          throw Error('publication unavailable');
        },
      }),
    );
    const response = await f.request('GET', '/api/internal/slack-notifications', undefined, {
      anonymous: true,
      headers: { authorization: 'Bearer cron-test' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.processed, 1);
    assert.equal(calls, 1);
    assert.equal((await rows(f))[0].status, 'done');
    assert.deepEqual(JSON.parse((await rows(f))[0].payload).receipt, {
      channel: 'C123',
      ts: '1234567890.123456',
    });
  } finally {
    await f.close();
  }
});

test('synthetic: an expired fifth processing claim reaches a terminal exhaustion state', async () => {
  const f = await setup();
  try {
    await f.create();
    const job = (await rows(f))[0];
    await f.db.transaction((tx) =>
      tx.exec("UPDATE outbox SET status='processing',attempts=5,next_attempt_at=? WHERE id=?", [
        '2000-01-01T00:00:00.000Z',
        job.id,
      ]),
    );
    let calls = 0;
    await runSlackDelivery(f.db, f.env, {
      fetcher: async () => {
        calls++;
        return receipt();
      },
    });
    assert.equal((await rows(f))[0].status, 'failed');
    assert.equal((await rows(f))[0].last_error, 'SLACK_ATTEMPTS_EXHAUSTED');
    assert.equal(calls, 0);
  } finally {
    await f.close();
  }
});

test('synthetic: activation suppresses older snapshot/history and notify off; retry errors store only codes', async () => {
  const f = await setup();
  try {
    await f.create();
    const job = (await rows(f))[0];
    await f.db.transaction((tx) =>
      tx.exec('UPDATE outbox SET created_at=? WHERE id=?', ['2000-01-01T00:00:00.000Z', job.id]),
    );
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return new Response('private provider content', { status: 503 });
    };
    await runSlackDelivery(f.db, f.env, { fetcher });
    assert.equal(calls, 0);
    assert.equal((await rows(f))[0].last_error, 'SLACK_NOT_ACTIVATED');
    await f.create();
    await runSlackDelivery(f.db, f.env, { fetcher, clock: () => Date.now() + 2000 });
    const retry = (await rows(f)).find((row) => row.status === 'pending');
    assert(retry);
    assert.equal(retry.last_error, 'SLACK_HTTP_503');
    assert.equal(retry.attempts, 1);
    await f.request('PATCH', '/api/v1/integrations/slack', {
      team_id: f.init.team_id,
      user_map: {},
      notify: false,
    });
    await runSlackDelivery(f.db, f.env, {
      fetcher,
      clock: () => Date.now() + 40000,
      deadline: Date.now() + 80000,
    });
    assert.equal(
      (await rows(f)).find((row) => row.id === retry.id).last_error,
      'SLACK_NOTIFY_DISABLED',
    );
    assert.equal(calls, 1);
  } finally {
    await f.close();
  }
});

test('synthetic: a duplicate terminal wake never delivers another task', async () => {
  const f = await setup();
  try {
    await f.create();
    const job = (await rows(f))[0];
    await runSlackDelivery(f.db, f.env, { fetcher: receipt });
    await f.create();
    let calls = 0;
    await processSlackMessage(
      f.db,
      f.env,
      { jobId: job.id },
      {
        clock: () => Date.now() + 2000,
        send: async () => {},
        fetcher: async () => {
          calls++;
          return receipt();
        },
      },
    );
    assert.equal(calls, 0);
  } finally {
    await f.close();
  }
});

test('synthetic: 429 preserves attempts and receipt persists after paced retry; duplicate wake is inert', async () => {
  const f = await setup();
  try {
    await f.create();
    let time = Date.now(),
      calls = 0;
    const fetcher = async () => {
      calls++;
      return calls === 1
        ? new Response('', { status: 429, headers: { 'retry-after': '120' } })
        : receipt();
    };
    await runSlackDelivery(f.db, f.env, { fetcher, clock: () => time });
    let job = (await rows(f))[0];
    assert.equal(job.status, 'pending');
    assert.equal(job.attempts, 0);
    await runSlackDelivery(f.db, f.env, { fetcher, clock: () => time + 119000 });
    assert.equal(calls, 1);
    time += 121000;
    await processSlackMessage(
      f.db,
      f.env,
      { jobId: job.id },
      { fetcher, clock: () => time, deadline: time + 40000 },
    );
    job = (await rows(f))[0];
    assert.equal(job.status, 'done');
    assert.deepEqual(JSON.parse(job.payload).receipt, { channel: 'C123', ts: '1234567890.123456' });
    await processSlackMessage(
      f.db,
      f.env,
      { jobId: job.id },
      { fetcher, clock: () => time, deadline: time + 40000 },
    );
    assert.equal(calls, 2);
  } finally {
    await f.close();
  }
});

test('synthetic: real GraphQL and OAuth MCP mutations wake after commit; integration echoes and rollback stay silent', async () => {
  const f = await setup();
  try {
    const deferred = [],
      sent = [];
    const app = createApplication({
      db: f.db,
      env: f.env,
      storage: f.storage,
      logger: { error: () => {} },
      defer: (promise) => deferred.push(promise),
      slackQueueSend: async (_topic, message) => sent.push(message),
    });
    const call = async (path, data, headers = {}) => {
      const response = await app.fetch(
        new Request(f.env.APP_URL + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(data),
        }),
      );
      assert(response.ok);
      return response.json();
    };
    const authHeaders = { cookie: f.session, origin: f.env.APP_URL, 'x-tickets-csrf': '1' };
    const graph = await call(
      '/graphql',
      {
        query: 'mutation($input:IssueCreateInput!){issueCreate(input:$input){success issue{id}}}',
        variables: { input: { teamId: f.init.team_id, title: 'GraphQL notification' } },
      },
      authHeaders,
    );
    assert.equal(graph.data.issueCreate.success, true);
    await Promise.all(deferred);
    assert.equal(sent.length, 1);
    const callback = 'https://chatgpt.com/connector_platform_oauth_redirect';
    const client = await call('/api/oauth/register', {
      redirect_uris: [callback],
      token_endpoint_auth_method: 'none',
    });
    const verifier = 'a'.repeat(64);
    const approved = await call(
      '/api/oauth/authorize',
      {
        client_id: client.client_id,
        redirect_uri: callback,
        response_type: 'code',
        resource: f.env.APP_URL + '/api/mcp',
        state: 'test-state',
        scope: 'read write',
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        approved: true,
      },
      authHeaders,
    );
    const tokenResponse = await app.fetch(
      new Request(f.env.APP_URL + '/api/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: client.client_id,
          redirect_uri: callback,
          resource: f.env.APP_URL + '/api/mcp',
          code: new URL(approved.redirect).searchParams.get('code'),
          code_verifier: verifier,
        }),
      }),
    );
    assert(tokenResponse.ok);
    const token = await tokenResponse.json();
    const result = await call(
      '/api/mcp',
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_issue',
          arguments: {
            input: { team_id: f.init.team_id, title: 'MCP notification' },
            idempotency_key: 'slack-test-mcp',
          },
        },
      },
      { authorization: `Bearer ${token.access_token}` },
    );
    assert.equal(result.result.isError, undefined);
    await Promise.all(deferred);
    assert.equal((await rows(f)).length, 2);
    const mcpJob = (await rows(f)).find(
      (job) => JSON.parse(job.payload).title === 'MCP notification',
    );
    assert(mcpJob);
    assert(sent.some((message) => message.jobId === mcpJob.id));
    await call(
      '/api/v1/issues',
      { team_id: f.init.team_id, title: 'REST notification' },
      authHeaders,
    );
    await Promise.all(deferred);
    assert.equal((await rows(f)).length, 3);
    const actor = {
      id: f.init.user_id,
      name: 'Owner',
      workspace_id: f.init.workspace_id,
      role: 'owner',
      scopes: ['read', 'write', 'admin'],
    };
    for (const flag of [{ integration: true }, { syncOrigin: 'linear' }])
      await f.db.transaction((tx) =>
        createIssue(tx, { ...actor, ...flag }, { team_id: f.init.team_id, title: 'Echo' }),
      );
    await assert.rejects(
      f.db.transaction(async (tx) => {
        await createIssue(tx, actor, { team_id: f.init.team_id, title: 'Rollback' });
        throw Error('rollback');
      }),
    );
    assert.equal((await rows(f)).length, 3);
  } finally {
    await f.close();
  }
});

test('synthetic: snapshots survive later edits, no-op changes are silent, failed publication recovers', async () => {
  const f = await setup();
  try {
    const issue = (await f.create({ title: 'Original title' })).data;
    await f.request('PATCH', `/api/v1/issues/${issue.id}`, { version: 1, title: 'Changed title' });
    await f.request('PATCH', `/api/v1/issues/${issue.id}`, { version: 2, title: 'Changed title' });
    const jobs = await rows(f);
    assert.equal(jobs.length, 2);
    assert.equal(JSON.parse(jobs[0].payload).title, 'Original title');
    assert.equal(jobs[1].event, 'updated');
    await assert.rejects(
      dispatchSlackNotifications(f.db, f.env, {
        send: async () => {
          throw Error('broker down');
        },
      }),
    );
    assert.equal((await rows(f))[0].status, 'pending');
    const messages = [];
    await dispatchSlackNotifications(f.db, f.env, {
      send: async (_topic, value) => messages.push(value),
    });
    assert.equal(messages.length, 2);
    assert.deepEqual(Object.keys(messages[0]), ['jobId']);
    const calls = [];
    await runSlackDelivery(f.db, f.env, {
      fetcher: async (_url, options) => {
        calls.push(JSON.parse(options.body));
        return receipt();
      },
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].text, /Original title/);
  } finally {
    await f.close();
  }
});

test('synthetic: preview, notify off, disable, legacy history and invalid receipt cannot publish', async () => {
  const f = await setup();
  try {
    await f.create();
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return Response.json({ ok: true });
    };
    await runSlackDelivery(f.db, { ...f.env, VERCEL_ENV: 'preview' }, { fetcher });
    assert.equal(calls, 0);
    await runSlackDelivery(f.db, f.env, { fetcher });
    assert.equal((await rows(f))[0].last_error, 'SLACK_RECEIPT_INVALID');
    await f.create();
    await f.request('PATCH', '/api/v1/modules/slack', { enabled: false });
    await runSlackDelivery(f.db, f.env, { fetcher, clock: () => Date.now() + 2000 });
    assert.equal(calls, 1);
    assert.equal((await rows(f))[1].status, 'suppressed');
    await f.request('PATCH', '/api/v1/modules/slack', { enabled: true });
    await f.create();
    assert.equal((await rows(f)).length, 2);
  } finally {
    await f.close();
  }
});

test('synthetic: unrelated successful or failed HTTP routes never republish an existing backlog', async () => {
  const f = await setup();
  try {
    await f.create();
    const deferred = [],
      sent = [];
    const wrapped = withSlackWake(
      { fetch: async () => Response.json({ ok: true }) },
      {
        db: f.db,
        env: f.env,
        defer: (work) => deferred.push(work),
        send: async (_topic, value) => sent.push(value),
      },
    );
    for (const path of ['/graphql', '/api/mcp', '/api/v1/issues'])
      await wrapped.fetch(new Request('https://example.test' + path, { method: 'POST' }));
    await Promise.all(deferred);
    assert.equal(deferred.length, 0);
    assert.equal(sent.length, 0);
    await wrapped.fetch(new Request('https://example.test/api/v1/issues'));
    assert.equal(deferred.length, 0);
    const failed = withSlackWake(
      { fetch: async () => new Response('', { status: 409 }) },
      { db: f.db, env: f.env, defer: (work) => deferred.push(work) },
    );
    await failed.fetch(new Request('https://example.test/graphql', { method: 'POST' }));
    assert.equal(deferred.length, 0);
    assert.equal(
      (await f.request('GET', '/api/internal/slack-notifications', undefined, { anonymous: true }))
        .status,
      401,
    );
  } finally {
    await f.close();
  }
});
