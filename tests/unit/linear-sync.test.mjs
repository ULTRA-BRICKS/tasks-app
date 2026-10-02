import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
import { hmac } from '../../packages/server/core/crypto.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';
import { runLinearSyncWorker } from '../../packages/server/modules/linear-sync/worker.mjs';
import { reconcileLinearWorkspace } from '../../packages/server/modules/linear-sync/reconcile.mjs';
import {
  syncFixture,
  linearWebhookPayload,
  signedWebhookRequest,
  fakeLinearTransport,
  fakeIssueRecord,
} from './linear-sync-fixture.mjs';

async function postWebhook(f, payload, secret, options) {
  const { raw, headers } = signedWebhookRequest(payload, secret, options);
  return f.request('POST', '/api/webhooks/linear', raw, { raw: true, anonymous: true, headers });
}
async function inboxRow(f, deliveryId) {
  return f.db.transaction((tx) =>
    tx.one('SELECT * FROM linear_webhook_inbox WHERE workspace_id=? AND delivery_id=?', [
      f.init.workspace_id,
      deliveryId,
    ]),
  );
}

test('webhook signature validation: valid signature accepted, invalid rejected, tampered body rejected', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const payload = linearWebhookPayload({
      type: 'Issue',
      action: 'update',
      dataId: source.ids.issue,
      organizationId: source.ids.org,
    });
    const good = await postWebhook(f, payload, 'linear-webhook-secret');
    expect(good.status).toBe(202);
    expect(good.data.accepted).toBe(true);
    const wrongSecret = signedWebhookRequest(payload, 'wrong-secret');
    const bad = await f.request('POST', '/api/webhooks/linear', wrongSecret.raw, {
      raw: true,
      anonymous: true,
      headers: wrongSecret.headers,
    });
    expect(bad.status).toBe(401);
    expect(bad.data.error.code).toBe('BAD_SIGNATURE');
    // Tampering the body after signing must also fail: the signature covers exact raw bytes.
    const validSignature = hmac('linear-webhook-secret', JSON.stringify(payload));
    const tamperedRaw = JSON.stringify({ ...payload, action: 'remove' });
    const tampered = await f.request('POST', '/api/webhooks/linear', tamperedRaw, {
      raw: true,
      anonymous: true,
      headers: { 'linear-signature': validSignature, 'linear-delivery': crypto.randomUUID() },
    });
    expect(tampered.status).toBe(401);
  } finally {
    await f.close();
  }
});

test('stale webhookTimestamp is rejected; a fresh one is accepted', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const stale = linearWebhookPayload({
      type: 'Issue',
      action: 'update',
      dataId: source.ids.issue,
      organizationId: source.ids.org,
      webhookTimestamp: Date.now() - 5 * 60 * 1000,
    });
    const staleResult = await postWebhook(f, stale, 'linear-webhook-secret');
    expect(staleResult.status).toBe(401);
    expect(staleResult.data.error.code).toBe('STALE_REQUEST');
    const fresh = linearWebhookPayload({
      type: 'Issue',
      action: 'update',
      dataId: source.ids.issue,
      organizationId: source.ids.org,
    });
    expect((await postWebhook(f, fresh, 'linear-webhook-secret')).status).toBe(202);
  } finally {
    await f.close();
  }
});

test('organizationId mismatch is rejected and never touches this workspace (tenant isolation)', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const foreign = linearWebhookPayload({
      type: 'Issue',
      action: 'update',
      dataId: source.ids.issue,
      organizationId: crypto.randomUUID(),
    });
    const result = await postWebhook(f, foreign, 'linear-webhook-secret');
    expect(result.status).toBe(403);
    expect(result.data.error.code).toBe('ORGANIZATION_NOT_ALLOWED');
    const count = await f.db.transaction((tx) =>
      tx.one('SELECT COUNT(*) AS n FROM linear_webhook_inbox WHERE workspace_id=?', [
        f.init.workspace_id,
      ]),
    );
    expect(Number(count.n)).toBe(0);
  } finally {
    await f.close();
  }
});

test('an unsupported resource type is accepted and explicitly recorded as unsupported, never silently dropped', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const payload = linearWebhookPayload({
      type: 'Project',
      action: 'create',
      dataId: crypto.randomUUID(),
      organizationId: source.ids.org,
    });
    const deliveryId = crypto.randomUUID();
    const result = await postWebhook(f, payload, 'linear-webhook-secret', { deliveryId });
    expect(result.status).toBe(202);
    const row = await inboxRow(f, deliveryId);
    expect(row.status).toBe('unsupported');
    // The worker never claims it (only pending/processing are eligible) and never marks it done.
    const before = row.status;
    await runLinearSyncWorker(f.db, f.env, {
      fetcher: async () => {
        throw new Error('must not be called for an unsupported row');
      },
    });
    const after = await inboxRow(f, deliveryId);
    expect(after.status).toBe(before);
  } finally {
    await f.close();
  }
});

test('duplicate delivery id: identical payload is idempotent; a different payload is recorded as a mismatch, never overwritten', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const payload = linearWebhookPayload({
      type: 'Issue',
      action: 'update',
      dataId: source.ids.issue,
      organizationId: source.ids.org,
    });
    const deliveryId = crypto.randomUUID();
    const first = await postWebhook(f, payload, 'linear-webhook-secret', { deliveryId });
    expect(first.status).toBe(202);
    expect(first.data.duplicate).toBe(false);
    const second = await postWebhook(f, payload, 'linear-webhook-secret', { deliveryId });
    expect(second.data.duplicate).toBe(true);
    expect(second.data.mismatch).toBeUndefined();
    const differentPayload = { ...payload, action: 'create' };
    const third = await postWebhook(f, differentPayload, 'linear-webhook-secret', { deliveryId });
    expect(third.data.duplicate).toBe(true);
    expect(third.data.mismatch).toBe(true);
    const mismatches = await f.db.transaction((tx) =>
      tx.all(
        'SELECT * FROM linear_webhook_inbox_mismatches WHERE workspace_id=? AND delivery_id=?',
        [f.init.workspace_id, deliveryId],
      ),
    );
    expect(mismatches).toHaveLength(1);
    const stored = await inboxRow(f, deliveryId);
    expect(JSON.parse(stored.payload).action).toBe('update'); // original, never overwritten
  } finally {
    await f.close();
  }
});

test('missing env credentials leave the feature inert (503), never crash', async () => {
  const f = await fixture();
  try {
    const payload = linearWebhookPayload({
      type: 'Issue',
      action: 'update',
      dataId: crypto.randomUUID(),
      organizationId: crypto.randomUUID(),
    });
    const { raw, headers } = signedWebhookRequest(payload, 'any-secret');
    const result = await f.request('POST', '/api/webhooks/linear', raw, {
      raw: true,
      anonymous: true,
      headers,
    });
    expect(result.status).toBe(503);
    expect(result.data.error.code).toBe('LINEAR_SYNC_NOT_CONFIGURED');
    // Configure the workspace but with no completed import: still inert.
    f.env.LINEAR_SYNC_WORKSPACE_ID = f.init.workspace_id;
    f.env.LINEAR_WEBHOOK_SECRET = 'linear-webhook-secret';
    const { raw: raw2, headers: headers2 } = signedWebhookRequest(payload, 'linear-webhook-secret');
    const result2 = await f.request('POST', '/api/webhooks/linear', raw2, {
      raw: true,
      anonymous: true,
      headers: headers2,
    });
    expect(result2.status).toBe(503);
    const workerResult = await runLinearSyncWorker(f.db, f.env, {
      fetcher: async () => {
        throw new Error('must not be called');
      },
    });
    expect(workerResult).toEqual({ processed: 0, blocked: 0, failed: 0 });
  } finally {
    await f.close();
  }
});

test('worker applies a pure remote-only field change (priority) with no local edit and no conflict', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const issueKey = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const before = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(before.data.priority).toBe(2);
    const remoteRecord = {
      ...source.data.issues[1],
      priority: 4,
      updatedAt: new Date().toISOString(),
    };
    const payload = linearWebhookPayload({
      type: 'Issue',
      action: 'update',
      dataId: source.ids.issue,
      organizationId: source.ids.org,
    });
    await postWebhook(f, payload, 'linear-webhook-secret');
    const result = await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        issuesById: { [source.ids.issue]: remoteRecord },
      }),
    });
    expect(result).toEqual({ processed: 1, blocked: 0, failed: 0 });
    const after = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(after.data.priority).toBe(4);
    expect(after.data.version).toBe(before.data.version + 1);
    const conflicts = await f.db.transaction((tx) =>
      tx.all('SELECT * FROM linear_sync_conflicts WHERE workspace_id=?', [f.init.workspace_id]),
    );
    expect(conflicts).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test('a genuine double-edit (local title edit + remote priority change) preserves the local title and records a conflict only when both sides disagree', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const issueKey = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const detail = await f.request('GET', '/api/v1/issues/' + issueKey);
    const editedTitle = 'Changed locally before Linear synced';
    const edited = await f.request('PATCH', '/api/v1/issues/' + issueKey, {
      title: editedTitle,
      version: detail.data.version,
    });
    expect(edited.status).toBe(200);
    const remoteRecord = {
      ...source.data.issues[1],
      priority: 3,
      updatedAt: new Date().toISOString(),
    };
    const payload = linearWebhookPayload({
      type: 'Issue',
      action: 'update',
      dataId: source.ids.issue,
      organizationId: source.ids.org,
    });
    await postWebhook(f, payload, 'linear-webhook-secret');
    const result = await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        issuesById: { [source.ids.issue]: remoteRecord },
      }),
    });
    expect(result).toEqual({ processed: 1, blocked: 0, failed: 0 });
    const after = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(after.data.title).toBe(editedTitle); // local edit survives: remote never touched title
    expect(after.data.priority).toBe(3); // local never touched priority: remote wins
    const conflicts = await f.db.transaction((tx) =>
      tx.all('SELECT * FROM linear_sync_conflicts WHERE workspace_id=?', [f.init.workspace_id]),
    );
    expect(conflicts).toHaveLength(0);

    // The first sync reconciled title=editedTitle as the new shared baseline. Make a SECOND,
    // independent local edit so local now diverges from that baseline...
    const secondLocalTitle = 'Second local edit, after the first sync reconciled';
    const patched = await f.request('PATCH', '/api/v1/issues/' + issueKey, {
      title: secondLocalTitle,
      version: after.data.version,
    });
    expect(patched.status).toBe(200);
    // ...and a remote change to the SAME field, to a THIRD value: now it's a genuine conflict.
    const remoteRecord2 = {
      ...remoteRecord,
      title: 'Renamed in Linear too',
      updatedAt: new Date().toISOString(),
    };
    const payload2 = linearWebhookPayload({
      type: 'Issue',
      action: 'update',
      dataId: source.ids.issue,
      organizationId: source.ids.org,
    });
    await postWebhook(f, payload2, 'linear-webhook-secret');
    await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        issuesById: { [source.ids.issue]: remoteRecord2 },
      }),
    });
    const afterConflict = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(afterConflict.data.title).toBe(secondLocalTitle); // local wins on genuine double-edit
    const recorded = await f.db.transaction((tx) =>
      tx.all('SELECT * FROM linear_sync_conflicts WHERE workspace_id=?', [f.init.workspace_id]),
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0].field).toBe('title');
    expect(recorded[0].resolved_at).toBeNull();
  } finally {
    await f.close();
  }
});

test('a missing dependency blocks the row without a partial write; the native row is untouched', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const issueKey = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const before = await f.request('GET', '/api/v1/issues/' + issueKey);
    const unknownProjectId = crypto.randomUUID(); // never imported, never mapped
    const remoteRecord = {
      ...source.data.issues[1],
      project: { id: unknownProjectId },
      updatedAt: new Date().toISOString(),
    };
    const payload = linearWebhookPayload({
      type: 'Issue',
      action: 'update',
      dataId: source.ids.issue,
      organizationId: source.ids.org,
    });
    const deliveryId = crypto.randomUUID();
    await postWebhook(f, payload, 'linear-webhook-secret', { deliveryId });
    const result = await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        issuesById: { [source.ids.issue]: remoteRecord },
      }),
    });
    expect(result).toEqual({ processed: 0, blocked: 1, failed: 0 });
    const row = await inboxRow(f, deliveryId);
    expect(row.status).toBe('blocked');
    expect(row.last_error).toBe('MISSING_REFERENCE');
    const after = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(after.data).toEqual(before.data); // completely untouched, no partial write
  } finally {
    await f.close();
  }
});

test('HTTP 429 with Retry-After schedules a retry instead of a crash loop', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const payload = linearWebhookPayload({
      type: 'Issue',
      action: 'update',
      dataId: source.ids.issue,
      organizationId: source.ids.org,
    });
    const deliveryId = crypto.randomUUID();
    await postWebhook(f, payload, 'linear-webhook-secret', { deliveryId });
    const before = Date.now();
    await runLinearSyncWorker(f.db, f.env, {
      fetcher: async () => new Response(null, { status: 429, headers: { 'retry-after': '120' } }),
    });
    const row = await inboxRow(f, deliveryId);
    expect(row.status).toBe('pending'); // not blocked, not failed: a scheduled retry
    expect(row.attempts).toBe(1);
    expect(Date.parse(row.next_attempt_at) - before).toBeGreaterThan(100000);
  } finally {
    await f.close();
  }
});

test('HTTP 400 with a RATELIMITED GraphQL error also retries rather than crashing', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const payload = linearWebhookPayload({
      type: 'Issue',
      action: 'update',
      dataId: source.ids.issue,
      organizationId: source.ids.org,
    });
    const deliveryId = crypto.randomUUID();
    await postWebhook(f, payload, 'linear-webhook-secret', { deliveryId });
    await runLinearSyncWorker(f.db, f.env, {
      fetcher: async () =>
        new Response(JSON.stringify({ errors: [{ extensions: { code: 'RATELIMITED' } }] }), {
          status: 400,
        }),
    });
    const row = await inboxRow(f, deliveryId);
    expect(row.status).toBe('pending');
  } finally {
    await f.close();
  }
});

test('a transaction rollback during the domain write leaves the inbox row retryable, never marked done', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const remoteRecord = {
      ...source.data.issues[1],
      priority: 3,
      updatedAt: new Date().toISOString(),
    };
    const payload = linearWebhookPayload({
      type: 'Issue',
      action: 'update',
      dataId: source.ids.issue,
      organizationId: source.ids.org,
    });
    const deliveryId = crypto.randomUUID();
    await postWebhook(f, payload, 'linear-webhook-secret', { deliveryId });
    const original = f.db.transaction.bind(f.db);
    let armed = false;
    f.db.transaction = (fn, options) =>
      original(async (tx) => {
        const wrapped = {
          ...tx,
          exec: async (sql, args) => {
            if (armed && sql.startsWith('UPDATE issues SET'))
              throw new Error('Simulated crash mid-write');
            return tx.exec(sql, args);
          },
        };
        return fn(wrapped);
      }, options);
    armed = true;
    const result = await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        issuesById: { [source.ids.issue]: remoteRecord },
      }),
    });
    f.db.transaction = original;
    expect(result.failed).toBe(1);
    const row = await inboxRow(f, deliveryId);
    expect(['pending', 'processing']).toContain(row.status);
    expect(row.attempts).toBe(1);
    const issueKey = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const after = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(after.data.priority).toBe(2); // unchanged: the update never committed
  } finally {
    await f.close();
  }
});

test('issue deletion at source tombstones the issue (content preserved), never hard-deletes', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const issueKey = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const before = await f.request('GET', '/api/v1/issues/' + issueKey);
    const payload = linearWebhookPayload({
      type: 'Issue',
      action: 'remove',
      dataId: source.ids.issue,
      organizationId: source.ids.org,
    });
    await postWebhook(f, payload, 'linear-webhook-secret');
    const result = await runLinearSyncWorker(f.db, f.env, {
      fetcher: async () => {
        throw new Error('remove must not hydrate over the network');
      },
    });
    expect(result).toEqual({ processed: 1, blocked: 0, failed: 0 });
    const gone = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(gone.status).toBe(404); // hidden from normal reads, like any soft-deleted issue
    const raw = await f.db.transaction((tx) =>
      tx.one('SELECT * FROM issues WHERE workspace_id=? AND id=?', [f.init.workspace_id, issueKey]),
    );
    expect(raw.deleted_at).not.toBeNull();
    expect(raw.title).toBe(before.data.title); // content preserved, never wiped
    const mapping = await f.db.transaction((tx) =>
      tx.one(
        'SELECT source_deleted_at FROM linear_source_map WHERE workspace_id=? AND collection=? AND source_id=?',
        [f.init.workspace_id, 'issues', source.ids.issue],
      ),
    );
    expect(mapping.source_deleted_at).not.toBeNull();
  } finally {
    await f.close();
  }
});

test('comment deletion at source tombstones via linear_source_map only (comments have no deleted_at column)', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const payload = linearWebhookPayload({
      type: 'Comment',
      action: 'remove',
      dataId: source.ids.comment,
      organizationId: source.ids.org,
    });
    await postWebhook(f, payload, 'linear-webhook-secret');
    const result = await runLinearSyncWorker(f.db, f.env, {
      fetcher: async () => {
        throw new Error('remove must not hydrate over the network');
      },
    });
    expect(result).toEqual({ processed: 1, blocked: 0, failed: 0 });
    const mapping = await f.db.transaction((tx) =>
      tx.one(
        'SELECT source_deleted_at,target_id FROM linear_source_map WHERE workspace_id=? AND collection=? AND source_id=?',
        [f.init.workspace_id, 'comments', source.ids.comment],
      ),
    );
    expect(mapping.source_deleted_at).not.toBeNull();
    const comment = await f.db.transaction((tx) =>
      tx.one('SELECT body FROM comments WHERE workspace_id=? AND id=?', [
        f.init.workspace_id,
        mapping.target_id,
      ]),
    );
    expect(comment.body).toBe(source.data.comments[0].body); // untouched
  } finally {
    await f.close();
  }
});

test('a brand-new Linear issue created after import is synced; a numbering collision blocks without a crash or silent overwrite', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const srcTeamId = targetId(f.init.workspace_id, source.ids.org, 'teams', source.ids.team);
    const local = await f.request('POST', '/api/v1/issues', {
      team_id: srcTeamId,
      title: 'Local new one',
    });
    expect(local.status).toBe(201);
    expect(local.data.number).toBe(9); // imported numbers were 7,8 -> next_number was 9
    const teamAfterLocal = await f.db.transaction((tx) =>
      tx.one('SELECT next_number FROM teams WHERE workspace_id=? AND id=?', [
        f.init.workspace_id,
        srcTeamId,
      ]),
    );
    expect(teamAfterLocal.next_number).toBe(10);

    // Collision: a new Linear issue claims the SAME number as the just-created local issue.
    const collidingSourceId = crypto.randomUUID();
    const colliding = fakeIssueRecord({
      id: collidingSourceId,
      identifier: 'SRC-9',
      number: 9,
      team: { id: source.ids.team },
      state: { id: source.ids.state },
    });
    const collidingPayload = linearWebhookPayload({
      type: 'Issue',
      action: 'create',
      dataId: collidingSourceId,
      organizationId: source.ids.org,
    });
    const collidingDelivery = crypto.randomUUID();
    await postWebhook(f, collidingPayload, 'linear-webhook-secret', {
      deliveryId: collidingDelivery,
    });
    const collisionResult = await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        issuesById: { [collidingSourceId]: colliding },
      }),
    });
    expect(collisionResult).toEqual({ processed: 0, blocked: 1, failed: 0 });
    const collisionRow = await inboxRow(f, collidingDelivery);
    expect(collisionRow.last_error).toBe('NUMBER_COLLISION');
    const teamAfterCollision = await f.db.transaction((tx) =>
      tx.one('SELECT next_number FROM teams WHERE workspace_id=? AND id=?', [
        f.init.workspace_id,
        srcTeamId,
      ]),
    );
    expect(teamAfterCollision.next_number).toBe(10); // unchanged: no silent overwrite

    // A non-colliding new Linear issue with a higher number: bumps next_number to number+1.
    const freshSourceId = crypto.randomUUID();
    const fresh = fakeIssueRecord({
      id: freshSourceId,
      identifier: 'SRC-15',
      number: 15,
      team: { id: source.ids.team },
      state: { id: source.ids.state },
    });
    const freshPayload = linearWebhookPayload({
      type: 'Issue',
      action: 'create',
      dataId: freshSourceId,
      organizationId: source.ids.org,
    });
    await postWebhook(f, freshPayload, 'linear-webhook-secret');
    const freshResult = await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        issuesById: { [freshSourceId]: fresh },
      }),
    });
    expect(freshResult).toEqual({ processed: 1, blocked: 0, failed: 0 });
    const teamAfterFresh = await f.db.transaction((tx) =>
      tx.one('SELECT next_number FROM teams WHERE workspace_id=? AND id=?', [
        f.init.workspace_id,
        srcTeamId,
      ]),
    );
    expect(teamAfterFresh.next_number).toBe(16);
    const createdKey = targetId(f.init.workspace_id, source.ids.org, 'issues', freshSourceId);
    const createdIssue = await f.request('GET', '/api/v1/issues/' + createdKey);
    expect(createdIssue.status).toBe(200);
    expect(createdIssue.data.title).toBe('Fresh from Linear');
  } finally {
    await f.close();
  }
});

test('reconcile resumes from a persisted cursor across two separate invocations, never restarting', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const page1Id = crypto.randomUUID(),
      page2Id = crypto.randomUUID();
    const calls = [];
    const fetcher = async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      if (body.query.includes('organization {'))
        return new Response(JSON.stringify({ data: { organization: { id: source.ids.org } } }), {
          status: 200,
        });
      if (body.query.includes('issues(')) {
        if (!body.variables.after)
          return new Response(
            JSON.stringify({
              data: {
                issues: {
                  pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
                  nodes: [{ id: page1Id, updatedAt: '2024-05-01T00:00:00.000Z' }],
                },
              },
            }),
            { status: 200 },
          );
        return new Response(
          JSON.stringify({
            data: {
              issues: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [{ id: page2Id, updatedAt: '2024-05-02T00:00:00.000Z' }],
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          data: { comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } },
        }),
        { status: 200 },
      );
    };
    const first = await reconcileLinearWorkspace(f.db, f.env, { fetcher, maxPages: 1 });
    expect(first.issues.pages).toBe(1);
    expect(first.issues.complete).toBe(false);
    const cursorAfterFirst = await f.db.transaction((tx) =>
      tx.one(
        'SELECT cursor,status FROM linear_sync_cursors WHERE workspace_id=? AND collection=?',
        [f.init.workspace_id, 'issues'],
      ),
    );
    expect(cursorAfterFirst.cursor).toBe('cursor-1');
    expect(cursorAfterFirst.status).toBe('in_progress');
    const issueCallsBeforeSecond = calls.filter((c) => c.query.includes('issues(')).length;
    expect(issueCallsBeforeSecond).toBe(1);

    const second = await reconcileLinearWorkspace(f.db, f.env, { fetcher, maxPages: 1 });
    const secondIssueCall = calls.filter((c) => c.query.includes('issues(')).at(-1);
    expect(secondIssueCall.variables.after).toBe('cursor-1'); // resumed, did not restart from null
    expect(second.issues.complete).toBe(true);
    const cursorAfterSecond = await f.db.transaction((tx) =>
      tx.one(
        'SELECT cursor,status FROM linear_sync_cursors WHERE workspace_id=? AND collection=?',
        [f.init.workspace_id, 'issues'],
      ),
    );
    expect(cursorAfterSecond.cursor).toBeNull();
    expect(cursorAfterSecond.status).toBe('complete');
    const enqueued = await f.db.transaction((tx) =>
      tx.all(
        "SELECT delivery_id FROM linear_webhook_inbox WHERE workspace_id=? AND resource_type='Issue' AND delivery_id LIKE 'reconcile:%'",
        [f.init.workspace_id],
      ),
    );
    expect(enqueued.map((r) => r.delivery_id).sort()).toEqual(
      [
        `reconcile:issues:${page1Id}:2024-05-01T00:00:00.000Z`,
        `reconcile:issues:${page2Id}:2024-05-02T00:00:00.000Z`,
      ].sort(),
    );
  } finally {
    await f.close();
  }
});

test('sync never creates or modifies rows in users or memberships', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const before = await f.db.transaction((tx) =>
      tx.one(
        'SELECT (SELECT COUNT(*) FROM users) AS users,(SELECT COUNT(*) FROM memberships) AS memberships',
      ),
    );
    const remoteRecord = {
      ...source.data.issues[1],
      priority: 4,
      updatedAt: new Date().toISOString(),
    };
    const payload = linearWebhookPayload({
      type: 'Issue',
      action: 'update',
      dataId: source.ids.issue,
      organizationId: source.ids.org,
    });
    await postWebhook(f, payload, 'linear-webhook-secret');
    await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        issuesById: { [source.ids.issue]: remoteRecord },
      }),
    });
    const after = await f.db.transaction((tx) =>
      tx.one(
        'SELECT (SELECT COUNT(*) FROM users) AS users,(SELECT COUNT(*) FROM memberships) AS memberships',
      ),
    );
    expect(Number(after.users)).toBe(Number(before.users));
    expect(Number(after.memberships)).toBe(Number(before.memberships));
  } finally {
    await f.close();
  }
});

test('admin status/conflicts/retry endpoints work and require admin permission', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const unknownProjectId = crypto.randomUUID();
    const remoteRecord = {
      ...source.data.issues[1],
      project: { id: unknownProjectId },
      updatedAt: new Date().toISOString(),
    };
    const payload = linearWebhookPayload({
      type: 'Issue',
      action: 'update',
      dataId: source.ids.issue,
      organizationId: source.ids.org,
    });
    const deliveryId = crypto.randomUUID();
    await postWebhook(f, payload, 'linear-webhook-secret', { deliveryId });
    await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        issuesById: { [source.ids.issue]: remoteRecord },
      }),
    });
    const status = await f.request('GET', '/api/v1/sync/linear/status');
    expect(status.status).toBe(200);
    expect(status.data.counts.blocked).toBe(1);
    const inbox = await inboxRow(f, deliveryId);
    const retry = await f.request('POST', '/api/v1/sync/linear/retry', { inbox_id: inbox.id });
    expect(retry.status).toBe(200);
    expect(retry.data.status).toBe('pending');
    await f.db.transaction((tx) =>
      tx.exec("UPDATE memberships SET role='viewer' WHERE workspace_id=? AND user_id=?", [
        f.init.workspace_id,
        f.init.user_id,
      ]),
    );
    const forbidden = await f.request('GET', '/api/v1/sync/linear/status');
    expect(forbidden.status).toBe(403);
  } finally {
    await f.close();
  }
});
