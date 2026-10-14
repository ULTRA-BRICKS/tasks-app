/** Synthetic acceptance adversaries use real HTTP mutations/outbox/consumer domain.
 * Only Slack/queue transport and time are substituted; observed corpus checks remain separate.
 */
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { hmac } from '../../packages/server/core/crypto.mjs';
import { runWorker } from '../../packages/server/modules/integrations/service.mjs';
import {
  runSlackDelivery,
  dispatchSlackNotifications,
  processSlackMessage,
} from '../../packages/server/modules/integrations/slack-delivery.mjs';

const jobs = (f) =>
  f.db.transaction((tx) =>
    tx.all(
      "SELECT * FROM outbox WHERE provider='slack' AND status NOT IN ('state','lease') ORDER BY created_at,id",
    ),
  );
const receipt = (channel = 'C123') => Response.json({ ok: true, channel, ts: '1234567890.123456' });
async function setup(appOptions = {}, extra = {}) {
  const f = await fixture(
    { SLACK_BOT_TOKEN: 'test-token', SLACK_CHANNEL_ID: 'C123', CRON_SECRET: 'cron-test', ...extra },
    { sqlitePath: ':memory:' },
    appOptions,
  );
  f.env.INTEGRATIONS_WORKSPACE_ID = f.init.workspace_id;
  await f.request('PATCH', '/api/v1/integrations/slack', {
    team_id: f.init.team_id,
    notify: true,
    user_map: { U123: f.init.user_id },
  });
  return f;
}

test('synthetic: reactivation cannot replay a snapshot even when timestamps tie; prior receipts do not verify a new activation', async () => {
  const f = await setup();
  try {
    await f.create();
    const oldJob = (await jobs(f))[0];
    await f.request('PATCH', '/api/v1/modules/slack', { enabled: false });
    await f.request('PATCH', '/api/v1/modules/slack', { enabled: true });
    await f.create({ title: 'Disabled-period silence' });
    assert.equal((await jobs(f)).length, 1);
    await f.request('PATCH', '/api/v1/integrations/slack', {
      team_id: f.init.team_id,
      notify: true,
    });
    const activation = await f.db.transaction((tx) =>
      tx.one("SELECT payload FROM outbox WHERE event='activation' AND workspace_id=?", [
        f.init.workspace_id,
      ]),
    );
    await f.db.transaction((tx) =>
      tx.exec('UPDATE outbox SET created_at=? WHERE id=?', [
        JSON.parse(activation.payload).activated_at,
        oldJob.id,
      ]),
    );
    let calls = 0;
    await runSlackDelivery(f.db, f.env, {
      fetcher: async () => {
        calls++;
        return receipt();
      },
    });
    assert.equal(calls, 0);
    assert.equal((await jobs(f))[0].status, 'suppressed');
    assert.equal(
      (await f.request('GET', '/api/v1/integrations')).data.slack.notifications.delivery_verified,
      false,
    );
    await f.create();
    await f.db.transaction((tx) =>
      tx.exec("UPDATE outbox SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE status='lease'"),
    );
    await runSlackDelivery(f.db, f.env, { fetcher: async () => receipt() });
    assert.equal(
      (await f.request('GET', '/api/v1/integrations')).data.slack.notifications.delivery_verified,
      true,
    );
    f.env.SLACK_CHANNEL_ID = 'C456';
    await f.request('PATCH', '/api/v1/integrations/slack', {
      team_id: f.init.team_id,
      notify: true,
    });
    const status = (await f.request('GET', '/api/v1/integrations')).data.slack.notifications;
    assert.equal(status.ready, true);
    assert.equal(status.delivery_verified, false);
    assert.equal(status.active, false);
  } finally {
    await f.close();
  }
});

test('synthetic: >20 backlog drains through authenticated cron and real callback continuation after publication failure', async () => {
  let time = Date.now() + 3000;
  const queued = [],
    calls = [];
  const send = async (_topic, message, options) => queued.push({ message, options });
  const sleep = async (milliseconds) => {
    time += milliseconds;
  };
  const fetcher = async (_url, options) => {
    calls.push({ time, body: JSON.parse(options.body) });
    return receipt();
  };
  const f = await setup({
    slackFetch: fetcher,
    slackDeliveryClock: () => time,
    slackDeliverySleep: sleep,
    slackQueueSend: send,
  });
  try {
    for (let n = 0; n < 25; n++)
      assert.equal((await f.create({ title: `Backlog ${n}` })).status, 201);
    await assert.rejects(
      dispatchSlackNotifications(f.db, f.env, {
        send: async () => {
          throw Error('broker down');
        },
        clock: () => time,
      }),
    );
    assert.equal((await jobs(f)).filter((job) => job.status === 'pending').length, 25);
    const recovery = await f.request('GET', '/api/internal/slack-notifications', undefined, {
      anonymous: true,
      headers: { authorization: 'Bearer cron-test' },
    });
    assert.equal(recovery.status, 200);
    assert.equal(recovery.data.processed, 20);
    assert(queued.length > 0);
    while (queued.length) {
      const wake = queued.shift();
      time += (wake.options.delaySeconds ?? 0) * 1000;
      await processSlackMessage(f.db, f.env, wake.message, {
        fetcher,
        clock: () => time,
        sleep,
        send,
        deadline: time + 40000,
      });
      assert(calls.length <= 25);
    }
    assert.equal(calls.length, 25);
    assert.equal((await jobs(f)).filter((job) => job.status === 'done').length, 25);
    for (let n = 1; n < calls.length; n++) assert(calls[n].time - calls[n - 1].time >= 1000);
  } finally {
    await f.close();
  }
});

test('synthetic: lost continuation publication retries the terminal callback without resending its receipt', async () => {
  const f = await setup();
  try {
    for (let n = 0; n < 3; n++) await f.create({ title: `Continuation ${n}` });
    let time = Date.now() + 3000,
      calls = 0;
    const clock = () => time,
      fetcher = async () => {
        calls++;
        return receipt();
      };
    const first = (await jobs(f))[0];
    await assert.rejects(
      processSlackMessage(
        f.db,
        f.env,
        { jobId: first.id },
        {
          fetcher,
          clock,
          send: async () => {
            throw Error('private broker diagnostic');
          },
        },
      ),
      (error) => error.code === 'SLACK_QUEUE_UNAVAILABLE' && !error.message.includes('private'),
    );
    assert.equal((await jobs(f)).find((job) => job.id === first.id).status, 'done');
    assert.equal(calls, 1);
    const wakes = [],
      send = async (_topic, message, options) => wakes.push({ message, options });
    await processSlackMessage(f.db, f.env, { jobId: first.id }, { fetcher, clock, send });
    assert.equal(calls, 1);
    while (wakes.length) {
      const wake = wakes.shift();
      time += (wake.options.delaySeconds ?? 0) * 1000;
      await processSlackMessage(f.db, f.env, wake.message, { fetcher, clock, send });
    }
    assert.equal(calls, 3);
    assert.equal((await jobs(f)).filter((job) => job.status === 'done').length, 3);
  } finally {
    await f.close();
  }
});

test('synthetic: an initial capped queue page continues past 20 with real consumer retries and no future HTTP requests', async () => {
  const f = await setup();
  try {
    for (let n = 0; n < 25; n++) await f.create({ title: `Queue page ${n}` });
    let time = Date.now() + 3000,
      calls = 0;
    const wakes = [],
      keys = new Set(),
      clock = () => time;
    const send = async (_topic, message, options) => {
      if (keys.has(options.idempotencyKey)) return;
      keys.add(options.idempotencyKey);
      wakes.push({ message, due: time + (options.delaySeconds ?? 0) * 1000 });
    };
    const initial = await dispatchSlackNotifications(f.db, f.env, { send, clock });
    assert.equal(initial.sent, 20);
    assert.equal(wakes.length, 20);
    while (wakes.length) {
      wakes.sort((a, b) => a.due - b.due);
      const wake = wakes.shift();
      time = Math.max(time, wake.due);
      try {
        await processSlackMessage(f.db, f.env, wake.message, {
          clock,
          send,
          fetcher: async () => {
            calls++;
            return receipt();
          },
        });
      } catch (error) {
        assert.equal(error.code, 'SLACK_RETRY');
        wakes.push({ message: wake.message, due: time + error.retryAfterSeconds * 1000 });
      }
      assert(calls <= 25);
    }
    assert.equal(calls, 25);
    assert.equal((await jobs(f)).filter((job) => job.status === 'done').length, 25);
  } finally {
    await f.close();
  }
});

test('synthetic: API error and malformed JSON never persist provider diagnostics', async () => {
  const f = await setup();
  try {
    await f.create();
    await runSlackDelivery(f.db, f.env, {
      fetcher: async () => Response.json({ ok: false, error: 'private secret diagnostic' }),
    });
    const first = (await jobs(f))[0];
    assert.equal(first.last_error, 'SLACK_API_UNKNOWN');
    assert(!JSON.stringify(first).includes('private secret'));
    await f.create();
    await runSlackDelivery(f.db, f.env, {
      clock: () => Date.now() + 2000,
      fetcher: async () => new Response('private secret malformed response'),
    });
    const malformed = (await jobs(f)).find((job) => job.status === 'failed');
    assert(malformed);
    assert.equal(malformed.last_error, 'SLACK_RECEIPT_INVALID');
    assert(!JSON.stringify(malformed).includes('private secret'));
  } finally {
    await f.close();
  }
});

test('synthetic: configured selection leaves all foreign workspace rows byte-for-byte unchanged, including fifth leases', async () => {
  const f = await setup();
  try {
    const foreign = crypto.randomUUID();
    await f.db.transaction(async (tx) => {
      await tx.exec('INSERT INTO workspaces(id,name,slug,created_at) VALUES(?,?,?,?)', [
        foreign,
        'Foreign synthetic',
        foreign,
        '2000-01-01T00:00:00.000Z',
      ]);
      for (const attempts of [0, 5])
        await tx.exec(
          "INSERT INTO outbox(id,workspace_id,provider,event,payload,status,attempts,next_attempt_at,created_at) VALUES(?,?,'slack','created','{}',?,?,?,?)",
          [
            crypto.randomUUID(),
            foreign,
            attempts ? 'processing' : 'pending',
            attempts,
            '2000-01-01T00:00:00.000Z',
            '2000-01-01T00:00:00.000Z',
          ],
        );
    });
    const readForeign = () =>
      f.db.transaction((tx) =>
        tx.all('SELECT * FROM outbox WHERE workspace_id=? ORDER BY id', [foreign]),
      );
    const before = JSON.stringify(await readForeign());
    await f.create();
    await runSlackDelivery(f.db, f.env, { fetcher: async () => receipt() });
    assert.equal(JSON.stringify(await readForeign()), before);
    assert.equal(
      (await jobs(f)).find((job) => job.workspace_id === f.init.workspace_id).status,
      'done',
    );
  } finally {
    await f.close();
  }
});

test('synthetic: an old deployment callback and publisher cannot mutate or publish a new destination job', async () => {
  const f = await setup();
  try {
    const oldEnv = { ...f.env };
    f.env.SLACK_CHANNEL_ID = 'C456';
    await f.request('PATCH', '/api/v1/integrations/slack', {
      team_id: f.init.team_id,
      notify: true,
    });
    await f.create();
    const job = (await jobs(f))[0],
      before = JSON.stringify(job);
    const sent = [];
    await dispatchSlackNotifications(f.db, oldEnv, {
      send: async (_topic, message) => sent.push(message),
    });
    assert.equal(sent.length, 0);
    const result = await processSlackMessage(
      f.db,
      oldEnv,
      { jobId: job.id },
      {
        fetcher: async () => {
          throw Error('must not send');
        },
        send: async () => {},
      },
    );
    assert.equal(result.status, 'inactive-destination');
    assert.equal(JSON.stringify((await jobs(f))[0]), before);
    await processSlackMessage(
      f.db,
      f.env,
      { jobId: job.id },
      { fetcher: async () => receipt('C456'), send: async () => {} },
    );
    assert.equal((await jobs(f))[0].status, 'done');
  } finally {
    await f.close();
  }
});

test('synthetic: Retry-After greater than one hour remains a provider floor without charging attempts', async () => {
  const f = await setup();
  try {
    await f.create();
    let time = Date.now() + 1000,
      calls = 0;
    const fetcher = async () => {
      calls++;
      return calls === 1
        ? new Response('', { status: 429, headers: { 'retry-after': '7200' } })
        : receipt();
    };
    await runSlackDelivery(f.db, f.env, { fetcher, clock: () => time });
    const job = (await jobs(f))[0];
    assert.equal(job.attempts, 0);
    assert(Date.parse(job.next_attempt_at) >= time + 7200000);
    await assert.rejects(
      processSlackMessage(
        f.db,
        f.env,
        { jobId: job.id },
        { fetcher, clock: () => time, send: async () => {} },
      ),
      (error) => error.code === 'SLACK_RETRY' && error.retryAfterSeconds >= 7200,
    );
    assert.equal(calls, 1);
    time += 3601000;
    await runSlackDelivery(f.db, f.env, { fetcher, clock: () => time, deadline: time + 40000 });
    assert.equal(calls, 1);
    time += 3600000;
    await runSlackDelivery(f.db, f.env, { fetcher, clock: () => time, deadline: time + 40000 });
    assert.equal(calls, 2);
  } finally {
    await f.close();
  }
});

test('synthetic: Unicode and pipe title labels stay inside closed controlled links; bodies remain bounded and inert', async () => {
  const f = await setup();
  try {
    const title = '💥|&<'.repeat(60);
    assert.equal(title.length, 300);
    const issue = (
      await f.create({
        title,
        description:
          'A & '.repeat(1500) + '\n[Long URL](https://example.test/' + 'x'.repeat(5000) + ')',
      })
    ).data;
    const messages = [];
    await runSlackDelivery(f.db, f.env, {
      fetcher: async (_url, options) => {
        messages.push(JSON.parse(options.body));
        return receipt();
      },
    });
    const message = messages[0];
    assert(message);
    const link = message.blocks[1].text.text;
    assert(link.startsWith(`<${f.env.APP_URL}/tasks/${issue.id}|`));
    assert(link.endsWith('>'));
    assert.equal((link.match(/\|/g) ?? []).length, 1);
    assert(!/[\uD800-\uDBFF]$/.test(link.slice(0, -1)));
    for (const block of message.blocks) {
      if (block.text) assert(block.text.text.length <= 3000);
      for (const field of block.fields ?? []) assert(field.text.length <= 2000);
    }
    assert(!message.blocks[2].text.text.includes('<'));
    assert(!/&[^;\s]*…$/.test(message.blocks[2].text.text));
  } finally {
    await f.close();
  }
});

test('synthetic: a bounded long user link preserves its readable label without a partial destination', async () => {
  const f = await setup();
  try {
    await f.create({ description: '[Long URL](https://example.test/' + 'x'.repeat(5000) + ')' });
    const messages = [];
    await runSlackDelivery(f.db, f.env, {
      fetcher: async (_url, options) => {
        messages.push(JSON.parse(options.body));
        return receipt();
      },
    });
    assert.equal(messages[0].blocks[2].text.text, 'Long URL …');
  } finally {
    await f.close();
  }
});

test('synthetic: notify:false confirmation escapes user mentions and readiness never equates arming with receipt verification', async () => {
  const f = await setup({}, { SLACK_SIGNING_SECRET: 'slack-secret', SLACK_TEAM_ID: 'T123' });
  try {
    f.env.SLACK_BOT_TOKEN = '';
    const status = (await f.request('GET', '/api/v1/integrations')).data.slack.notifications;
    assert.equal(status.armed, true);
    assert.equal(status.ready, false);
    assert.equal(status.delivery_verified, false);
    assert.equal(status.active, false);
    f.env.SLACK_BOT_TOKEN = 'test-token';
    await f.request('PATCH', '/api/v1/integrations/slack', {
      team_id: f.init.team_id,
      notify: false,
    });
    const raw = new URLSearchParams({
      command: '/tickets',
      text: '<!channel> <@U123> & plain',
      team_id: 'T123',
      channel_id: 'C123',
      user_id: 'U123',
    }).toString();
    const timestamp = String(Math.floor(Date.now() / 1000));
    assert.equal(
      (
        await f.request('POST', '/api/webhooks/slack', raw, {
          raw: true,
          anonymous: true,
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'x-slack-request-timestamp': timestamp,
            'x-slack-signature': 'v0=' + hmac('slack-secret', `v0:${timestamp}:${raw}`),
          },
        })
      ).status,
      200,
    );
    const messages = [];
    await runWorker(f.db, f.env, {
      fetcher: async (_url, options) => {
        messages.push(JSON.parse(options.body));
        return receipt();
      },
    });
    assert.equal(messages.length, 1);
    assert(messages[0].text.includes('&lt;!channel&gt; &lt;@U123&gt; &amp; plain'));
    assert(!messages[0].text.includes('<!channel>'));
    assert.equal((await jobs(f))[0].event, 'confirmation');
  } finally {
    await f.close();
  }
});
