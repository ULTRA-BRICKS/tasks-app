import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fixture } from './helpers.mjs';
import { nodeHandler } from '../../packages/server/node-adapter.mjs';
import { TicketsClient } from '../../packages/sdk/index.mjs';
import { hmac } from '../../packages/server/core/crypto.mjs';
import { runWorker } from '../../packages/server/modules/integrations/service.mjs';
function cli(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['packages/cli/tickets.mjs', ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}
test('CLI help runs without installed dependencies or credentials', async () => {
  const r = await cli(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /--version/);
});
test('SDK blocks non-HTTPS remote credentials', () =>
  assert.throws(() => new TicketsClient({ url: 'http://example.com', token: 'secret' }), /HTTPS/));
test('CLI traverses real HTTP API: create, get, update, conflict, list', async () => {
  const f = await fixture(),
    token = (
      await f.request('POST', '/api/v1/tokens', { name: 'CLI test', scopes: ['read', 'write'] })
    ).data.token;
  const server = createServer(nodeHandler(f.app));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port,
    env = { TICKETS_URL: `http://127.0.0.1:${port}`, TICKETS_TOKEN: token };
  try {
    const created = await cli(
      ['issues', 'create', '--team', 'TKT', '--title', 'Created through CLI', '--json'],
      env,
    );
    assert.equal(created.code, 0, created.stderr);
    const issue = JSON.parse(created.stdout);
    assert.equal(issue.key, 'TKT-1');
    const fetched = await cli(['issues', 'get', issue.key, '--json'], env);
    assert.equal(fetched.code, 0);
    assert.equal(JSON.parse(fetched.stdout).title, 'Created through CLI');
    const updated = await cli(
      ['issues', 'update', issue.key, '--version', '1', '--priority', '1'],
      env,
    );
    assert.equal(updated.code, 0, updated.stderr);
    assert.equal(JSON.parse(updated.stdout).version, 2);
    const stale = await cli(
      ['issues', 'update', issue.key, '--version', '1', '--priority', '4'],
      env,
    );
    assert.equal(stale.code, 4);
    assert.equal(JSON.parse(stale.stderr).error.code, 'VERSION_CONFLICT');
    const list = await cli(['issues', 'list', '--all', '--json'], env);
    assert.equal(list.code, 0);
    assert.equal(JSON.parse(list.stdout).length, 1);
    const client = new TicketsClient({ url: env.TICKETS_URL, token });
    assert.equal((await client.catalog()).teams[0].key, 'TKT');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await f.close();
  }
});
test('signed Slack slash command maps a member, creates once and sends via injected transport', async () => {
  const f = await fixture({
    SLACK_SIGNING_SECRET: 'slack-secret',
    SLACK_TEAM_ID: 'T123',
    SLACK_CHANNEL_ID: 'C123',
    SLACK_BOT_TOKEN: 'test-token',
  });
  f.env.INTEGRATIONS_WORKSPACE_ID = f.init.workspace_id;
  try {
    const config = await f.request('PATCH', '/api/v1/integrations/slack', {
      team_id: f.init.team_id,
      user_map: { U123: f.init.user_id },
      notify: false,
    });
    assert.equal(config.status, 200);
    const raw = new URLSearchParams({
        command: '/tickets',
        text: 'Created from Slack',
        team_id: 'T123',
        channel_id: 'C123',
        user_id: 'U123',
        response_url: 'https://evil.example/credential',
        trigger_id: 'secret-trigger',
      }).toString(),
      timestamp = String(Math.floor(Date.now() / 1000)),
      headers = {
        'content-type': 'application/x-www-form-urlencoded',
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': 'v0=' + hmac('slack-secret', `v0:${timestamp}:${raw}`),
      };
    const first = await f.request('POST', '/api/webhooks/slack', raw, {
      raw: true,
      anonymous: true,
      headers,
    });
    assert.equal(first.status, 200);
    assert.equal(
      (await f.request('POST', '/api/webhooks/slack', raw, { raw: true, anonymous: true, headers }))
        .data.duplicate,
      true,
    );
    const stored = await f.db.transaction((tx) =>
      tx.one('SELECT payload FROM webhook_deliveries LIMIT 1'),
    );
    assert(!stored.payload.includes('response_url'));
    assert(!stored.payload.includes('trigger_id'));
    const calls = [];
    const result = await runWorker(f.db, f.env, {
      fetcher: async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    assert.equal(result.failed, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://slack.com/api/chat.postMessage');
    assert.equal(
      (await f.request('GET', '/api/v1/issues')).data.data[0].title,
      'Created from Slack',
    );
  } finally {
    await f.close();
  }
});
test('Slack requests from unmapped users cannot create issues', async () => {
  const f = await fixture({
    SLACK_SIGNING_SECRET: 'slack-secret',
    SLACK_TEAM_ID: 'T123',
    SLACK_CHANNEL_ID: 'C123',
  });
  f.env.INTEGRATIONS_WORKSPACE_ID = f.init.workspace_id;
  try {
    const raw = 'command=%2Ftickets&text=bad&team_id=T123&channel_id=C123&user_id=U404',
      timestamp = String(Math.floor(Date.now() / 1000));
    await f.request('POST', '/api/webhooks/slack', raw, {
      raw: true,
      anonymous: true,
      headers: {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': 'v0=' + hmac('slack-secret', `v0:${timestamp}:${raw}`),
      },
    });
    const result = await runWorker(f.db, f.env);
    assert.equal(result.failed, 1);
    assert.equal((await f.request('GET', '/api/v1/issues')).data.data.length, 0);
  } finally {
    await f.close();
  }
});
