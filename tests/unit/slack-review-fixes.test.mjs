/** Synthetic recorded-review regressions use real SQLite/Postgres transactions and HTTP.
 * Postgres scheduling barriers delay transaction entry, never replace SQL or commit behavior.
 */
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { createApplication } from '../../api/index.mjs';
import {
  runSlackDelivery,
  withSlackWake,
  processSlackMessage,
  dispatchSlackNotifications,
} from '../../packages/server/modules/integrations/slack-delivery.mjs';
import { runWorker } from '../../packages/server/modules/integrations/service.mjs';
import { captureSlackNotification } from '../../packages/server/modules/integrations/slack-notifications.mjs';
import { hmac } from '../../packages/server/core/crypto.mjs';

const receipt = () => Response.json({ ok: true, channel: 'C123', ts: '1234567890.123456' });
const rows = (f) =>
  f.db.transaction((tx) => tx.all("SELECT * FROM outbox WHERE provider='slack' ORDER BY id"));
const jobs = async (f) => (await rows(f)).filter((row) => !['state', 'lease'].includes(row.status));
function barrier() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function setup() {
  const f = await fixture({ SLACK_BOT_TOKEN: 'test-token', SLACK_CHANNEL_ID: 'C123' });
  f.env.INTEGRATIONS_WORKSPACE_ID = f.init.workspace_id;
  await f.request('PATCH', '/api/v1/integrations/slack', {
    team_id: f.init.team_id,
    notify: true,
    user_map: {},
  });
  return f;
}
function delayedAuthorization(db, arrived, release) {
  let calls = 0;
  return {
    ...db,
    async transaction(fn, options) {
      calls++;
      if (calls === 2) {
        arrived.resolve();
        await release.promise;
      }
      return db.transaction(fn, options);
    },
  };
}

test.skipIf(!process.env.TEST_DATABASE_URL)(
  'synthetic PG: stale worker A cannot post or finalize after worker B completes its expired claim',
  async () => {
    const f = await setup(),
      arrived = barrier(),
      release = barrier();
    let pending;
    try {
      await f.create();
      let time = Date.now() + 1000,
        calls = 0;
      const fetcher = async () => {
        calls++;
        return receipt();
      };
      pending = runSlackDelivery(delayedAuthorization(f.db, arrived, release), f.env, {
        fetcher,
        clock: () => time,
      });
      await arrived.promise;
      time += 31000;
      const b = await runSlackDelivery(f.db, f.env, { fetcher, clock: () => time });
      assert.equal(b.processed, 1);
      const afterB = JSON.stringify(await rows(f));
      release.resolve();
      const a = await pending;
      assert.equal(calls, 1);
      assert.equal(a.processed, 0);
      assert.equal(JSON.stringify(await rows(f)), afterB);
    } finally {
      release.resolve();
      await pending?.catch(() => {});
      await f.close();
    }
  },
);

test.skipIf(!process.env.TEST_DATABASE_URL)(
  'synthetic PG: disable first prevents POST; send first holds the policy lock until bounded IO finishes',
  async () => {
    const f = await setup(),
      arrived = barrier(),
      release = barrier();
    let pending;
    try {
      await f.create();
      let calls = 0;
      pending = runSlackDelivery(delayedAuthorization(f.db, arrived, release), f.env, {
        fetcher: async () => {
          calls++;
          return receipt();
        },
      });
      await arrived.promise;
      assert.equal(
        (await f.request('PATCH', '/api/v1/modules/slack', { enabled: false })).status,
        200,
      );
      release.resolve();
      await pending;
      assert.equal(calls, 0);
      await f.request('PATCH', '/api/v1/modules/slack', { enabled: true });
      await f.request('PATCH', '/api/v1/integrations/slack', {
        team_id: f.init.team_id,
        notify: true,
      });
      await f.create();
      const postStarted = barrier(),
        finishPost = barrier();
      pending = runSlackDelivery(f.db, f.env, {
        clock: () => Date.now() + 2000,
        fetcher: async () => {
          calls++;
          postStarted.resolve();
          await finishPost.promise;
          return receipt();
        },
      });
      await postStarted.promise;
      let disabled = false;
      const disable = f
        .request('PATCH', '/api/v1/modules/slack', { enabled: false })
        .then((result) => {
          disabled = true;
          return result;
        });
      const probe = await f.db.transaction((tx) =>
        tx.one('SELECT pg_try_advisory_xact_lock(hashtext(?)) AS acquired', [f.init.workspace_id]),
      );
      finishPost.resolve();
      await pending;
      assert.equal((await disable).status, 200);
      assert.equal(probe.acquired, false);
      assert.equal(calls, 1);
      assert(disabled);
      assert((await jobs(f)).some((job) => job.status === 'done'));
    } finally {
      release.resolve();
      await pending?.catch(() => {});
      await f.close();
    }
  },
);

test('synthetic: only original explicit notify:true can arm after disable, map-only changes or a channel change', async () => {
  const f = await setup();
  try {
    await f.request('PATCH', '/api/v1/modules/slack', { enabled: false });
    await f.request('PATCH', '/api/v1/modules/slack', { enabled: true });
    await f.request('PATCH', '/api/v1/integrations/slack', {
      team_id: f.init.team_id,
      user_map: { U1: f.init.user_id },
    });
    assert.equal(
      (await f.request('GET', '/api/v1/integrations')).data.slack.notifications.armed,
      false,
    );
    await f.create();
    assert.equal((await jobs(f)).length, 0);
    await f.request('PATCH', '/api/v1/integrations/slack', {
      team_id: f.init.team_id,
      notify: true,
    });
    const before = (await rows(f)).find((row) => row.event === 'activation').payload;
    f.env.SLACK_CHANNEL_ID = 'C456';
    await f.request('PATCH', '/api/v1/integrations/slack', {
      team_id: f.init.team_id,
      user_map: {},
    });
    assert.equal((await rows(f)).find((row) => row.event === 'activation').payload, before);
    assert.equal(
      (await f.request('GET', '/api/v1/integrations')).data.slack.notifications.ready,
      false,
    );
  } finally {
    await f.close();
  }
});

test('synthetic: runWorker delivers a bounded paced batch of three without editing gates', async () => {
  const f = await setup();
  try {
    for (let n = 0; n < 3; n++) await f.create({ title: `Batch ${n}` });
    let time = Date.now() + 1000;
    const times = [];
    const result = await runWorker(f.db, f.env, {
      limit: 3,
      clock: () => time,
      sleep: async (milliseconds) => {
        time += milliseconds;
      },
      fetcher: async () => {
        times.push(time);
        return receipt();
      },
    });
    assert.equal(result.processed, 3);
    assert.equal(result.failed, 0);
    assert.equal(times.length, 3);
    assert(times[1] - times[0] >= 1000);
    assert(times[2] - times[1] >= 1000);
  } finally {
    await f.close();
  }
});

test('synthetic: paced worker respects its remaining deadline without manually changing gates', async () => {
  const f = await setup();
  try {
    for (let n = 0; n < 3; n++) await f.create();
    let time = Date.now() + 1000;
    const deadline = time + 1500;
    const result = await runWorker(f.db, f.env, {
      limit: 3,
      clock: () => time,
      deadline,
      sleep: async (ms) => {
        time += ms;
      },
      fetcher: async () => receipt(),
    });
    assert.equal(result.processed, 2);
    assert(time < deadline);
    assert.equal((await jobs(f)).filter((job) => job.status === 'pending').length, 1);
  } finally {
    await f.close();
  }
});

test('synthetic: late mixed incoming/GitHub work uses one remaining budget for transport and JSON body', async () => {
  const f = await setup();
  let finishBody, timer;
  try {
    Object.assign(f.env, {
      SLACK_SIGNING_SECRET: 'slack-secret',
      SLACK_TEAM_ID: 'T1',
      GITHUB_TOKEN: 'test-token',
      GITHUB_REPOSITORY: 'synthetic/tasks',
    });
    await f.request('PATCH', '/api/v1/integrations/slack', {
      team_id: f.init.team_id,
      notify: false,
      user_map: { U1: f.init.user_id },
    });
    const issue = (await f.create()).data;
    await f.request('POST', `/api/v1/issues/${issue.id}/export/github`, {});
    const raw = new URLSearchParams({
        command: '/tickets',
        text: 'Incoming budget',
        team_id: 'T1',
        channel_id: 'C123',
        user_id: 'U1',
      }).toString(),
      timestamp = String(Math.floor(Date.now() / 1000));
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
    let time = Date.now(),
      phase = 0;
    const deadline = time + 55000;
    const db = {
      ...f.db,
      transaction: async (fn, options) => {
        if (++phase === 2) time = deadline - 50;
        return f.db.transaction(fn, options);
      },
    };
    const start = Date.now();
    const result = await runWorker(db, f.env, {
      clock: () => time,
      deadline,
      fetcher: async (url) => {
        if (url.startsWith('https://slack.com/')) return receipt();
        return new Response(
          new ReadableStream({
            start(controller) {
              finishBody = () => {
                controller.enqueue(
                  new TextEncoder().encode(
                    JSON.stringify({
                      number: 1,
                      title: 'Synthetic',
                      html_url: 'https://github.com/synthetic/tasks/issues/1',
                    }),
                  ),
                );
                controller.close();
              };
              timer = setTimeout(finishBody, 500);
            },
          }),
          { status: 201 },
        );
      },
    });
    assert(Date.now() - start < 350);
    assert(result.processed >= 1);
    assert.equal(
      (await f.db.transaction((tx) => tx.one('SELECT status FROM webhook_deliveries LIMIT 1')))
        .status,
      'done',
    );
  } finally {
    clearTimeout(timer);
    try {
      finishBody?.();
    } catch {}
    await f.close();
  }
});

test.skipIf(!process.env.TEST_DATABASE_URL)(
  'synthetic PG: a blocked pool checkout respects the caller budget and cannot claim after expiry',
  async () => {
    const f = await setup(),
      release = barrier(),
      ready = Array.from({ length: 4 }, () => barrier());
    let timer;
    const holders = [];
    try {
      await f.create();
      for (const mark of ready)
        holders.push(
          f.db.transaction(async (tx) => {
            await tx.one('SELECT 1 AS ready');
            mark.resolve();
            await release.promise;
          }),
        );
      await Promise.all(ready.map((mark) => mark.promise));
      const start = Date.now();
      timer = setTimeout(() => release.resolve(), 500);
      await runSlackDelivery(f.db, f.env, {
        deadline: start + 100,
        fetcher: async () => {
          throw Error('must not POST');
        },
      });
      assert(Date.now() - start < 300);
    } finally {
      clearTimeout(timer);
      release.resolve();
      await Promise.all(holders);
    }
    try {
      const job = (await jobs(f))[0];
      assert.equal(job.status, 'pending');
      assert.equal(job.attempts, 0);
    } finally {
      await f.close();
    }
  },
);

test.skipIf(!process.env.TEST_DATABASE_URL)(
  'synthetic PG: an active transaction budget rolls back its write and releases the policy lock',
  async () => {
    const f = await setup();
    try {
      await assert.rejects(
        f.db.transaction(
          async (tx) => {
            await tx.lock(f.init.workspace_id);
            await tx.exec(
              "UPDATE module_settings SET enabled=0 WHERE workspace_id=? AND module='slack'",
              [f.init.workspace_id],
            );
            await tx.one('SELECT pg_sleep(1)');
          },
          { timeoutMs: 100 },
        ),
        (error) => error.code === 'DB_TRANSACTION_TIMEOUT' || error.code === '57014',
      );
      const state = await f.db.transaction((tx) =>
        tx.one("SELECT enabled FROM module_settings WHERE workspace_id=? AND module='slack'", [
          f.init.workspace_id,
        ]),
      );
      assert.equal(state.enabled, 1);
      const probe = await f.db.transaction((tx) =>
        tx.one('SELECT pg_try_advisory_xact_lock(hashtext(?)) AS acquired', [f.init.workspace_id]),
      );
      assert.equal(probe.acquired, true);
    } finally {
      await f.close();
    }
  },
);

test.skipIf(!process.env.TEST_DATABASE_URL)(
  'synthetic PG: response body timeout releases policy lock and leaves an owned retry, even when transport ignores abort',
  async () => {
    const f = await setup();
    try {
      await f.create();
      const start = Date.now();
      const result = await runSlackDelivery(f.db, f.env, {
        deadline: start + 300,
        fetcher: async () => new Response(new ReadableStream()),
      });
      assert(Date.now() - start < 2000);
      assert.equal(result.failed, 1);
      const job = (await jobs(f))[0];
      assert.equal(job.status, 'pending');
      assert.equal(job.last_error, 'SLACK_UNREACHABLE');
      const probe = await f.db.transaction((tx) =>
        tx.one('SELECT pg_try_advisory_xact_lock(hashtext(?)) AS acquired', [f.init.workspace_id]),
      );
      assert.equal(probe.acquired, true);
      assert.equal(
        (await f.request('PATCH', '/api/v1/modules/slack', { enabled: false })).status,
        200,
      );
    } finally {
      await f.close();
    }
  },
);

test('synthetic: unrelated, no-op and rolled-back concurrent HTTP requests do not republish a 20-job backlog', async () => {
  const f = await setup();
  try {
    const issues = [];
    for (let n = 0; n < 20; n++) issues.push((await f.create({ title: `Backlog ${n}` })).data);
    const sent = [],
      deferred = [],
      diagnostics = [];
    const app = createApplication({
      db: f.db,
      env: f.env,
      storage: f.storage,
      logger: { error: (item) => diagnostics.push(item) },
      defer: (work) => deferred.push(work),
      slackQueueSend: async (_topic, message) => sent.push(message),
    });
    const call = async (path, method, data) =>
      app.fetch(
        new Request(f.env.APP_URL + path, {
          method,
          headers: {
            'content-type': 'application/json',
            cookie: f.session,
            origin: f.env.APP_URL,
            'x-tickets-csrf': '1',
          },
          body: JSON.stringify(data),
        }),
      );
    const results = await Promise.all([
      call('/api/v1/tokens', 'POST', { name: 'Local test', scopes: ['read'] }),
      call(`/api/v1/issues/${issues[0].id}`, 'PATCH', { version: 1, title: issues[0].title }),
      call('/api/oauth/register', 'POST', {
        redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
        token_endpoint_auth_method: 'none',
      }),
      call('/api/v1/issues/bulk', 'PATCH', {
        updates: [
          { id: issues[1].id, patch: { version: 1, title: 'Rollback pending' } },
          { id: issues[2].id, patch: { version: 999, title: 'Rollback failure' } },
        ],
      }),
    ]);
    assert.deepEqual(
      results.map((response) => response.status),
      [201, 200, 201, 409],
    );
    await Promise.all(deferred);
    assert.equal(sent.length, 0);
    assert.equal((await jobs(f)).length, 20);
    const [created] = await Promise.all([
      call('/api/v1/issues', 'POST', { team_id: f.init.team_id, title: 'Committed request' }),
      call('/api/v1/tokens', 'POST', { name: 'Concurrent unrelated', scopes: ['read'] }),
    ]);
    const createdIssue = await created.json();
    await Promise.all(deferred);
    const newJob = (await jobs(f)).find(
      (job) => JSON.parse(job.payload).issue_id === createdIssue.id,
    );
    assert(newJob);
    assert.deepEqual(sent, [{ jobId: newJob.id }]);
    assert.deepEqual(diagnostics, []);
  } finally {
    await f.close();
  }
});

test('synthetic: actor projection reads bounded mapped rows rather than the full imported identity directory', async () => {
  const f = await setup();
  f.env.SLACK_TEAM_ID = 'T1';
  try {
    const issue = (await f.create()).data;
    await f.db.transaction(async (tx) => {
      for (let n = 0; n < 1000; n++)
        await tx.exec(
          "INSERT INTO source_people(id,workspace_id,provider,source_id,name) VALUES(?,?,'linear',?,?)",
          [`synthetic-person-${n}`, f.init.workspace_id, `synthetic-source-${n}`, `Synthetic ${n}`],
        );
      await tx.exec(
        "INSERT INTO source_people(id,workspace_id,provider,source_id,name) VALUES(?,?,'slack','T1:U1','Slack Owner')",
        [crypto.randomUUID(), f.init.workspace_id],
      );
    });
    await f.request('PATCH', '/api/v1/integrations/slack', {
      team_id: f.init.team_id,
      notify: true,
      user_map: { U1: f.init.user_id },
    });
    const oldIds = new Set((await jobs(f)).map((job) => job.id));
    let identityRows = 0,
      identityQueries = 0;
    await f.db.transaction(async (tx) => {
      const measured = {
        ...tx,
        all: async (sql, args) => {
          const result = await tx.all(sql, args);
          if (/FROM source_people|JOIN memberships/.test(sql)) {
            identityRows += result.length;
            identityQueries++;
          }
          return result;
        },
        one: async (sql, args) => {
          const result = await tx.one(sql, args);
          if (/FROM source_people|JOIN memberships/.test(sql)) {
            identityRows += result ? 1 : 0;
            identityQueries++;
          }
          return result;
        },
      };
      await captureSlackNotification(
        measured,
        { id: f.init.user_id, name: 'Owner', workspace_id: f.init.workspace_id },
        issue,
        'created',
        {},
        new Date().toISOString(),
      );
    });
    assert(identityRows <= 2, `actor lookup returned ${identityRows} identity rows`);
    assert(identityQueries <= 2);
    assert.equal(
      JSON.parse((await jobs(f)).find((job) => !oldIds.has(job.id)).payload).actor,
      'Slack Owner',
    );
  } finally {
    await f.close();
  }
});

test('synthetic: actor projection seeks the complete Slack identity index and never borrows another team', async () => {
  const f = await setup();
  f.env.SLACK_TEAM_ID = 'T1';
  try {
    const issue = (await f.create()).data;
    await f.db.transaction(async (tx) => {
      await tx.exec(
        "WITH RECURSIVE profiles(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM profiles WHERE n<1999) INSERT INTO source_people(id,workspace_id,provider,source_id,name) SELECT 'index-person-'||n,?,'slack','T1:UX'||n,'Unrelated Slack '||n FROM profiles",
        [f.init.workspace_id],
      );
      await tx.exec(
        "INSERT INTO source_people(id,workspace_id,provider,source_id,name) VALUES('index-owner',?,'slack','T1:U1','Slack Owner')",
        [f.init.workspace_id],
      );
      if (tx.dialect === 'postgres') await tx.exec('ANALYZE source_people');
    });
    const configure = (user_map, extra = {}) =>
      f.request('PATCH', '/api/v1/integrations/slack', {
        team_id: f.init.team_id,
        user_map,
        ...extra,
      });
    assert.equal((await configure({ U1: f.init.user_id }, { notify: true })).status, 200);
    const activation = () =>
      f.db.transaction((tx) =>
        tx.one("SELECT * FROM outbox WHERE provider='slack' AND event='activation'"),
      );
    const activated = await activation();
    assert.equal((await configure({ U1: f.init.user_id }, { notify: true })).status, 200);
    assert.deepEqual(await activation(), activated, 'explicit re-save cannot reset activation');
    assert.equal((await configure({ U1: f.init.user_id }, { team: 'T2' })).status, 422);
    assert.deepEqual(await activation(), activated, 'client input cannot set server team identity');
    assert.equal(
      (await runSlackDelivery(f.db, f.env, { fetcher: async () => receipt() })).processed,
      1,
    );
    const receipts = (await jobs(f)).filter((job) => job.status === 'done');
    assert.equal(receipts.length, 1);
    async function capture(expected, lookup) {
      const oldIds = new Set((await jobs(f)).map((job) => job.id));
      const queries = [];
      await f.db.transaction(async (tx) => {
        const measured = { ...tx };
        for (const method of ['one', 'all'])
          measured[method] = async (sql, args) => {
            if (/FROM source_people/.test(sql)) queries.push({ sql, args });
            return tx[method](sql, args);
          };
        await captureSlackNotification(
          measured,
          { id: f.init.user_id, name: 'Owner', workspace_id: f.init.workspace_id },
          issue,
          'created',
          {},
          new Date().toISOString(),
        );
        assert.equal(queries.length, lookup ? 1 : 0);
        for (const { sql, args } of queries) {
          const plan = await tx.all(
            (tx.dialect === 'postgres' ? 'EXPLAIN (FORMAT JSON) ' : 'EXPLAIN QUERY PLAN ') + sql,
            args,
          );
          const detail = JSON.stringify(plan);
          assert.match(detail, /source_id[ =]+(?:\\?\?|=)/);
          if (tx.dialect === 'postgres') {
            assert.match(detail, /Index (?:Only )?Scan/);
            assert.match(detail, /Index Cond/);
            assert.match(detail, /workspace_id.*provider.*source_id/);
          } else {
            assert.match(detail, /USING INDEX/);
            assert.match(detail, /workspace_id=\? AND provider=\? AND source_id=\?/);
          }
          assert.deepEqual(args, [f.init.workspace_id, `T1:${lookup}`]);
        }
      });
      assert.equal(
        JSON.parse((await jobs(f)).find((job) => !oldIds.has(job.id)).payload).actor,
        expected,
      );
    }
    await capture('Slack Owner', 'U1');
    await f.db.transaction((tx) =>
      tx.exec(
        "INSERT INTO source_people(id,workspace_id,provider,source_id,name) VALUES('foreign-owner',?,'slack','T2:U1','Foreign Owner'),('foreign-missing',?,'slack','T2:UMISSING','Foreign Missing')",
        [f.init.workspace_id, f.init.workspace_id],
      ),
    );
    await capture('Slack Owner', 'U1');
    await configure({ UMISSING: f.init.user_id });
    await capture('Owner', 'UMISSING');
    assert.deepEqual(await activation(), activated, 'map-only edits must preserve activation');
    await f.db.transaction(async (tx) => {
      const payload = JSON.parse(activated.payload);
      delete payload.team;
      await tx.exec('UPDATE outbox SET payload=? WHERE id=?', [
        JSON.stringify(payload),
        activated.id,
      ]);
    });
    const legacy = await activation();
    await configure({ U1: f.init.user_id });
    assert.deepEqual(await activation(), legacy, 'map-only edits cannot hydrate legacy activation');
    await capture('Owner', null);
    await configure({ U1: f.init.user_id }, { notify: true });
    const hydrated = await activation();
    assert.deepEqual(JSON.parse(hydrated.payload), { ...JSON.parse(legacy.payload), team: 'T1' });
    assert.equal(hydrated.created_at, legacy.created_at);
    assert.equal(hydrated.next_attempt_at, legacy.next_attempt_at);
    assert.deepEqual(
      (await jobs(f)).filter((job) => job.status === 'done'),
      receipts,
    );
    await capture('Slack Owner', 'U1');
    await configure({ U1: f.init.user_id, U2: f.init.user_id });
    await capture('Owner', null);
    await configure({ U1: f.init.user_id });
    await f.db.transaction((tx) =>
      tx.exec(
        "INSERT INTO module_settings(workspace_id,module,enabled,config) VALUES(?,'slack-profiles',1,?) ON CONFLICT(workspace_id,module) DO UPDATE SET config=excluded.config",
        [f.init.workspace_id, JSON.stringify({ profiles: { 'T1:U1': { bot: true } } })],
      ),
    );
    await capture('Owner', 'U1');
  } finally {
    await f.close();
  }
});

test('synthetic: nested real HTTP subrequests share committed jobs and publication failures log only the fixed code', async () => {
  const f = await setup();
  try {
    for (let n = 0; n < 20; n++) await f.create();
    const deferred = [],
      diagnostics = [],
      published = [];
    const app = createApplication({
      db: f.db,
      env: f.env,
      storage: f.storage,
      logger: { error: (entry) => diagnostics.push(entry) },
      defer: (work) => deferred.push(work),
      slackQueueSend: async () => {
        throw Object.assign(Error('private response test-token'), { code: 'private-code' });
      },
    });
    const request = (path, data) =>
      new Request(f.env.APP_URL + path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: f.session,
          origin: f.env.APP_URL,
          'x-tickets-csrf': '1',
        },
        body: JSON.stringify(data),
      });
    const parent = withSlackWake(
      {
        fetch: async () => {
          const created = await app.fetch(
            request('/api/v1/issues', { team_id: f.init.team_id, title: 'Nested commit' }),
          );
          assert.equal(created.status, 201);
          await app.fetch(
            request('/api/v1/tokens', { name: 'Nested unrelated', scopes: ['read'] }),
          );
          return Response.json(await created.json());
        },
      },
      {
        db: f.db,
        env: f.env,
        logger: { error: (entry) => diagnostics.push(entry) },
        defer: (work) => deferred.push(work),
        send: async (_topic, message) => {
          published.push(message);
          throw Object.assign(Error('private response test-token'), { code: 'private-code' });
        },
      },
    );
    assert.equal((await parent.fetch(request('/synthetic-parent', {}))).status, 200);
    await Promise.all(deferred);
    assert.equal(published.length, 1);
    assert.deepEqual(diagnostics, [{ code: 'SLACK_QUEUE_UNAVAILABLE' }]);
    assert.equal((await jobs(f)).filter((job) => job.status === 'pending').length, 21);
  } finally {
    await f.close();
  }
});

test.skipIf(!process.env.TEST_DATABASE_URL)(
  'synthetic PG: expiry after real transaction setup prevents entering the domain callback',
  async () => {
    const f = await setup(),
      { Pool } = await import('pg');
    const poolPrototype = Object.getPrototypeOf(Pool.prototype),
      connect = Object.getOwnPropertyDescriptor(poolPrototype, 'connect'),
      now = Date.now;
    let offset = 0,
      entered = false,
      active = true;
    try {
      Date.now = () => now() + offset;
      poolPrototype.connect = async function (...args) {
        const client = await Promise.resolve(Reflect.apply(connect.value, this, args)),
          query = client.query.bind(client);
        client.query = async (...input) => {
          const result = await query(...input);
          if (active && String(input[0]).startsWith("SELECT set_config('statement_timeout'"))
            offset = 2000;
          return result;
        };
        return client;
      };
      await assert.rejects(
        f.db.transaction(
          async (tx) => {
            entered = true;
            await tx.one('SELECT 1');
          },
          { timeoutMs: 1000 },
        ),
        (error) => error.code === 'DB_TRANSACTION_TIMEOUT',
      );
      assert.equal(entered, false);
    } finally {
      active = false;
      Object.defineProperty(poolPrototype, 'connect', connect);
      Date.now = now;
      await f.close();
    }
  },
);

test.skipIf(!process.env.TEST_DATABASE_URL)(
  'synthetic PG: callback and continuation reads share the caller deadline during blocked checkout',
  async () => {
    for (const caller of ['callback', 'dispatch']) {
      const f = await setup(),
        release = barrier(),
        ready = Array.from({ length: 4 }, () => barrier()),
        holders = [];
      let timer;
      try {
        await f.create();
        const job = (await jobs(f))[0];
        for (const mark of ready)
          holders.push(
            f.db.transaction(async (tx) => {
              await tx.one('SELECT 1');
              mark.resolve();
              await release.promise;
            }),
          );
        await Promise.all(ready.map((mark) => mark.promise));
        const start = Date.now();
        timer = setTimeout(() => release.resolve(), 500);
        const options = {
          deadline: start + 100,
          send: async () => {
            throw Error('must not publish');
          },
          fetcher: async () => {
            throw Error('must not POST');
          },
        };
        await assert.rejects(
          caller === 'callback'
            ? processSlackMessage(f.db, f.env, { jobId: job.id }, options)
            : dispatchSlackNotifications(f.db, f.env, options),
          (error) => error.code === 'DB_TRANSACTION_TIMEOUT',
        );
        assert(Date.now() - start < 300);
      } finally {
        clearTimeout(timer);
        release.resolve();
        await Promise.all(holders);
        await f.close();
      }
    }
  },
);
