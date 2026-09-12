import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { id, now, hmac } from '../../packages/server/core/crypto.mjs';
import { runWorker } from '../../packages/server/modules/integrations/service.mjs';
import { migrate } from '../../packages/db/index.mjs';
test('token issuance rejects write-only tokens that cannot pass the read boundary', async () => {
  const f = await fixture();
  try {
    const r = await f.request('POST', '/api/v1/tokens', { name: 'bad scopes', scopes: ['write'] });
    assert.equal(r.status, 422);
    assert.equal(r.data.error.code, 'READ_SCOPE_REQUIRED');
  } finally {
    await f.close();
  }
});
test('numbered migrations include avatar metadata and reject an unknown newer schema', async () => {
  const f = await fixture();
  try {
    const current = await migrate(f.db);
    assert.equal(current.version, 3);
    assert.equal(current.applied, false);
    // Exercise the migrated column directly on both supported database dialects.
    const row = await f.db.transaction((tx) => tx.one('SELECT avatar_url FROM users LIMIT 1'));
    assert(row && Object.hasOwn(row, 'avatar_url'));
    await f.db.transaction((tx) =>
      tx.exec('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)', [999, now()]),
    );
    await assert.rejects(() => migrate(f.db), /newer than this application/);
  } finally {
    await f.close();
  }
});
test('an early GitHub webhook echo of our export links the original instead of importing a duplicate', async () => {
  const f = await fixture({
    GITHUB_REPOSITORY: 'example/tickets',
    GITHUB_WEBHOOK_SECRET: 'unit-webhook-secret',
  });
  f.env.INTEGRATIONS_WORKSPACE_ID = f.init.workspace_id;
  try {
    const issue = (await f.create({ title: 'Original local issue' })).data,
      outboxId = id();
    await f.db.transaction((tx) =>
      tx.exec(
        "INSERT INTO outbox(id,workspace_id,provider,event,payload,status,attempts,next_attempt_at,created_at) VALUES(?,?,'github','export',?,'processing',1,?,?)",
        [
          outboxId,
          f.init.workspace_id,
          JSON.stringify({ issue_id: issue.id, key: issue.key, title: issue.title }),
          new Date(Date.now() + 3600000).toISOString(),
          now(),
        ],
      ),
    );
    const raw = JSON.stringify({
      action: 'opened',
      repository: { id: 7, full_name: 'example/tickets' },
      issue: {
        number: 42,
        title: '[TKT-1] Original local issue',
        body: `<!-- tickets-outbox:${outboxId} -->`,
        html_url: 'https://github.com/example/tickets/issues/42',
      },
    });
    const receipt = await f.request('POST', '/api/webhooks/github', raw, {
      raw: true,
      anonymous: true,
      headers: {
        'x-github-event': 'issues',
        'x-github-delivery': 'early-export-echo',
        'x-hub-signature-256': 'sha256=' + hmac('unit-webhook-secret', raw),
      },
    });
    assert.equal(receipt.status, 202);
    const result = await runWorker(f.db, f.env);
    assert.equal(result.failed, 0);
    const rows = (await f.request('GET', '/api/v1/issues')).data.data;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, issue.id);
    const link = await f.db.transaction((tx) =>
      tx.one('SELECT issue_id FROM external_links LIMIT 1'),
    );
    assert.equal(link.issue_id, issue.id);
  } finally {
    await f.close();
  }
});
test('outgoing jobs cannot leak one workspace into another workspace provider credentials', async () => {
  const f = await fixture({
    SLACK_BOT_TOKEN: 'unit-only-token',
    SLACK_CHANNEL_ID: 'C1',
    INTEGRATIONS_WORKSPACE_ID: 'different-workspace',
  });
  try {
    await f.db.transaction((tx) =>
      tx.exec(
        "INSERT INTO outbox(id,workspace_id,provider,event,payload,status,attempts,next_attempt_at,created_at) VALUES(?,?,'slack','created',?,'pending',0,?,?)",
        [
          id(),
          f.init.workspace_id,
          JSON.stringify({ issue_id: id(), key: 'TKT-1', title: 'Private title' }),
          now(),
          now(),
        ],
      ),
    );
    let called = false;
    const result = await runWorker(f.db, f.env, {
      fetcher: async () => {
        called = true;
        throw new Error('Unexpected external delivery');
      },
    });
    assert.equal(called, false);
    assert.equal(result.failed, 1);
    const job = await f.db.transaction((tx) => tx.one('SELECT last_error FROM outbox LIMIT 1'));
    assert.equal(job.last_error, 'WORKSPACE_NOT_CONFIGURED');
  } finally {
    await f.close();
  }
});
