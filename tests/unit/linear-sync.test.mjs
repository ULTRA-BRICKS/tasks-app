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
  jsonResponse,
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

// finding A: Linear expects a 2xx receipt promptly; a durably-queued delivery must
// respond 200 (not the GitHub/Slack-style 202 fire-and-forget receipt), and the row is
// queued 'pending' regardless of whether inline processing (via `defer`) runs. `defer`
// is unset in this test fixture (mirrors how dispatchMail's `defer` is exercised
// elsewhere in this suite), so this only asserts the durable receipt shape, not the
// inline worker run itself.
test('finding A: an accepted signed webhook responds 200 and durably queues a pending inbox row', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const payload = linearWebhookPayload({
      type: 'Issue',
      action: 'update',
      dataId: source.ids.issue,
      organizationId: source.ids.org,
    });
    const deliveryId = crypto.randomUUID();
    const result = await postWebhook(f, payload, 'linear-webhook-secret', { deliveryId });
    expect(result.status).toBe(200);
    expect(result.data.accepted).toBe(true);
    const row = await inboxRow(f, deliveryId);
    expect(row.status).toBe('pending');
  } finally {
    await f.close();
  }
});

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
    expect(good.status).toBe(200);
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
    expect((await postWebhook(f, fresh, 'linear-webhook-secret')).status).toBe(200);
  } finally {
    await f.close();
  }
});

test('a malformed webhook body (null / array / missing data.id) is rejected as 400 before any workspace lock or DB write', async () => {
  const { f } = await syncFixture(fixture);
  try {
    for (const body of [null, [], { type: 'Issue', action: 'update' }, { data: {} }]) {
      const raw = JSON.stringify(body);
      const result = await f.request('POST', '/api/webhooks/linear', raw, {
        raw: true,
        anonymous: true,
        headers: {
          'linear-signature': hmac('linear-webhook-secret', raw),
          'linear-delivery': crypto.randomUUID(),
        },
      });
      expect(result.status).toBe(400);
    }
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
    expect(result.status).toBe(200);
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
    expect(first.status).toBe(200);
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

// finding 4 (claim/generation fencing): a row claimed by "worker A" whose lease expires
// before it finishes must not be able to overwrite or reset a newer claim ("worker B")
// that reclaimed the SAME row in the meantime -- on BOTH the success path (applyInboxRow)
// and the failure path (recordFailure). Two real, separate runLinearSyncWorker calls are
// interleaved by hand: worker A's injected fetcher captures its real claim_token (read
// back from the row right after claimNextInboxRow's transaction commits, which always
// happens before any fetcher call) and then stalls on a deferred promise -- outside any
// transaction, exactly where the architecture comment says hydration happens -- so worker
// B can claim, hydrate and apply for real while A is still "in flight". Releasing A then
// lets its own claimNextInboxRow-returned job (with the now-stale claim_token) reach
// applyInboxRow/recordFailure for real, exercising the actual fencing check.
test('finding 4: a superseded (lease-expired) claim is fenced out on both the success and the failure path', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const issueKey = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);

    // --- Success-path race -----------------------------------------------------------
    const deliveryId1 = crypto.randomUUID();
    await postWebhook(
      f,
      linearWebhookPayload({
        type: 'Issue',
        action: 'update',
        dataId: source.ids.issue,
        organizationId: source.ids.org,
      }),
      'linear-webhook-secret',
      { deliveryId: deliveryId1 },
    );

    let claimTokenA1 = null;
    let markClaimed1;
    const claimed1 = new Promise((resolve) => {
      markClaimed1 = resolve;
    });
    let releaseA1;
    const stall1 = new Promise((resolve) => {
      releaseA1 = resolve;
    });
    const remoteRecordA1 = {
      ...source.data.issues[1],
      priority: 3,
      updatedAt: new Date().toISOString(),
    };
    const realFetcher1 = fakeLinearTransport({
      organizationId: source.ids.org,
      issuesById: { [source.ids.issue]: remoteRecordA1 },
    });
    const fetcherA1 = async (url, options) => {
      if (!claimTokenA1) {
        const row = await inboxRow(f, deliveryId1);
        claimTokenA1 = row.claim_token;
        markClaimed1();
        await stall1; // worker A is claimed and "in flight", not yet applied
      }
      return realFetcher1(url, options);
    };
    const workerA1Promise = runLinearSyncWorker(f.db, f.env, { fetcher: fetcherA1 });
    await claimed1;
    expect(claimTokenA1).toBeTruthy();

    // Simulate A's lease expiring before it finishes.
    await f.db.transaction((tx) =>
      tx.exec(
        'UPDATE linear_webhook_inbox SET next_attempt_at=? WHERE workspace_id=? AND delivery_id=?',
        [new Date(Date.now() - 60000).toISOString(), f.init.workspace_id, deliveryId1],
      ),
    );

    // Worker B reclaims the SAME row (status is still 'processing', but next_attempt_at
    // is now in the past) with a FRESH claim_token, and applies for real.
    const remoteRecordB1 = {
      ...source.data.issues[1],
      priority: 4,
      updatedAt: new Date(Date.now() + 1000).toISOString(),
    };
    const resultB1 = await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        issuesById: { [source.ids.issue]: remoteRecordB1 },
      }),
    });
    expect(resultB1).toEqual({ processed: 1, blocked: 0, failed: 0 });
    const rowAfterB1 = await inboxRow(f, deliveryId1);
    expect(rowAfterB1.status).toBe('done');
    expect(rowAfterB1.claim_token).not.toBe(claimTokenA1);
    const claimTokenB1 = rowAfterB1.claim_token;
    const afterB1 = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(afterB1.data.priority).toBe(4);

    // Release worker A: its OWN claimNextInboxRow-returned job still carries claim_token
    // A1. applyInboxRow must detect the row's claim_token no longer matches and skip --
    // never double-apply, never overwrite B's newer claim.
    releaseA1();
    const resultA1 = await workerA1Promise;
    expect(resultA1).toEqual({ processed: 0, blocked: 0, failed: 0 });
    const rowAfterA1Attempt = await inboxRow(f, deliveryId1);
    expect(rowAfterA1Attempt.status).toBe('done'); // exactly as B left it
    expect(rowAfterA1Attempt.claim_token).toBe(claimTokenB1); // never reset to A's token
    const stillB1 = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(stillB1.data.priority).toBe(4); // A's stale write never applied
    expect(stillB1.data.version).toBe(afterB1.data.version); // no extra version bump from A

    // --- Failure-path race (a fresh delivery on the same issue) ----------------------
    const deliveryId2 = crypto.randomUUID();
    await postWebhook(
      f,
      linearWebhookPayload({
        type: 'Issue',
        action: 'update',
        dataId: source.ids.issue,
        organizationId: source.ids.org,
      }),
      'linear-webhook-secret',
      { deliveryId: deliveryId2 },
    );

    let claimTokenA2 = null;
    let markClaimed2;
    const claimed2 = new Promise((resolve) => {
      markClaimed2 = resolve;
    });
    let releaseA2;
    const stall2 = new Promise((resolve) => {
      releaseA2 = resolve;
    });
    const fetcherA2 = async () => {
      if (!claimTokenA2) {
        const row = await inboxRow(f, deliveryId2);
        claimTokenA2 = row.claim_token;
        markClaimed2();
        await stall2;
      }
      throw new Error('Simulated failure from a worker that was already superseded');
    };
    const workerA2Promise = runLinearSyncWorker(f.db, f.env, { fetcher: fetcherA2 });
    await claimed2;
    expect(claimTokenA2).toBeTruthy();

    await f.db.transaction((tx) =>
      tx.exec(
        'UPDATE linear_webhook_inbox SET next_attempt_at=? WHERE workspace_id=? AND delivery_id=?',
        [new Date(Date.now() - 60000).toISOString(), f.init.workspace_id, deliveryId2],
      ),
    );

    const remoteRecordB2 = {
      ...source.data.issues[1],
      priority: 1,
      updatedAt: new Date(Date.now() + 2000).toISOString(),
    };
    const resultB2 = await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        issuesById: { [source.ids.issue]: remoteRecordB2 },
      }),
    });
    expect(resultB2).toEqual({ processed: 1, blocked: 0, failed: 0 });
    const rowAfterB2 = await inboxRow(f, deliveryId2);
    expect(rowAfterB2.status).toBe('done');
    const claimTokenB2 = rowAfterB2.claim_token;
    expect(claimTokenB2).not.toBe(claimTokenA2);

    // Release worker A2: its own attempt now fails (a real thrown error), and
    // recordFailure must detect the stale claim_token and skip its write entirely --
    // the row must stay exactly as B2 left it, never reset to 'pending'/'failed'.
    releaseA2();
    await workerA2Promise;
    const rowAfterA2Attempt = await inboxRow(f, deliveryId2);
    expect(rowAfterA2Attempt.status).toBe('done'); // NOT reset to 'pending' or 'failed'
    expect(rowAfterA2Attempt.claim_token).toBe(claimTokenB2); // still B2's token
    expect(rowAfterA2Attempt.last_error).toBeNull(); // A2's stale failure never recorded
    const afterA2Attempt = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(afterA2Attempt.data.priority).toBe(1); // B2's applied value, untouched by A2
  } finally {
    await f.close();
  }
});

// P2: Issue:remove/Comment:remove are supported deliveries now (see webhook.mjs's
// SUPPORTED set and worker.mjs's applyRemove/handleImplicitRestore). A verified remove
// sets a MARKER (linear_source_map.source_deleted_at, or linear_removal_receipts for an
// unmapped id) -- it never hard- or soft-deletes native content, and it never calls
// fetchIssue/fetchComment (the entity is gone; a read would only ever say not_found,
// which is exactly the ambiguous signal this design refuses to treat as deletion proof).

function removePayload({ type, dataId, organizationId, createdAt }) {
  return {
    action: 'remove',
    type,
    createdAt: createdAt ?? new Date().toISOString(),
    data: { id: dataId },
    organizationId,
    webhookTimestamp: Date.now(),
    webhookId: crypto.randomUUID(),
  };
}
// Stronger proof than grep that a remove delivery makes ZERO calls to fetchIssue/
// fetchComment: a bug that accidentally routed a remove through the entity-hydration path
// fails this fetcher immediately (a thrown error) instead of silently returning a missing/
// wrong record that might coincidentally still produce the right test outcome.
function removeOnlyFetcher(organizationId) {
  return async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.query.includes('organization {'))
      return jsonResponse({ data: { organization: { id: organizationId } } });
    throw new Error('A remove delivery must never call fetchIssue/fetchComment: ' + body.query);
  };
}
async function sourceMapRow(f, collection, sourceId) {
  return f.db.transaction((tx) =>
    tx.one(
      'SELECT target_id,source_deleted_at,last_removed_at,restored_at,source_updated_at FROM linear_source_map WHERE workspace_id=? AND collection=? AND source_id=?',
      [f.init.workspace_id, collection, sourceId],
    ),
  );
}

test('P2: a signed Issue:remove delivery sets the source-deleted marker; native content retained, hydration never called', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const issueKey = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const before = await f.request('GET', '/api/v1/issues/' + issueKey);
    const removedAt = new Date().toISOString();
    const payload = removePayload({
      type: 'Issue',
      dataId: source.ids.issue,
      organizationId: source.ids.org,
      createdAt: removedAt,
    });
    const deliveryId = crypto.randomUUID();
    const received = await postWebhook(f, payload, 'linear-webhook-secret', { deliveryId });
    expect(received.status).toBe(200);
    expect((await inboxRow(f, deliveryId)).status).toBe('pending'); // supported, queued
    const result = await runLinearSyncWorker(f.db, f.env, {
      fetcher: removeOnlyFetcher(source.ids.org),
    });
    expect(result).toEqual({ processed: 1, blocked: 0, failed: 0 });
    const after = await f.request('GET', '/api/v1/issues/' + issueKey);
    // Every native field is untouched; `activity` legitimately grows by one entry (the
    // "was deleted in Linear" record itself) -- compared separately below.
    const { activity: beforeActivity, ...beforeFields } = before.data;
    const { activity: afterActivity, ...afterFields } = after.data;
    expect(afterFields).toEqual(beforeFields);
    expect(afterActivity).toHaveLength(beforeActivity.length + 1);
    expect(afterActivity[0].summary).toBe('was deleted in Linear');
    const mapping = await sourceMapRow(f, 'issues', source.ids.issue);
    expect(mapping.source_deleted_at).toBe(removedAt);
    expect(mapping.last_removed_at).toBe(removedAt);
    expect(mapping.restored_at).toBeNull();
    expect((await inboxRow(f, deliveryId)).status).toBe('done');
  } finally {
    await f.close();
  }
});

test('P2: a signed Comment:remove delivery sets the source-deleted marker; native content retained, hydration never called', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const removedAt = new Date().toISOString();
    const payload = removePayload({
      type: 'Comment',
      dataId: source.ids.comment,
      organizationId: source.ids.org,
      createdAt: removedAt,
    });
    const deliveryId = crypto.randomUUID();
    await postWebhook(f, payload, 'linear-webhook-secret', { deliveryId });
    const result = await runLinearSyncWorker(f.db, f.env, {
      fetcher: removeOnlyFetcher(source.ids.org),
    });
    expect(result).toEqual({ processed: 1, blocked: 0, failed: 0 });
    const mapping = await sourceMapRow(f, 'comments', source.ids.comment);
    expect(mapping.source_deleted_at).toBe(removedAt);
    const comment = await f.db.transaction((tx) =>
      tx.one('SELECT body FROM comments WHERE workspace_id=? AND id=?', [
        f.init.workspace_id,
        mapping.target_id,
      ]),
    );
    expect(comment.body).toBe(source.data.comments[0].body); // untouched, never erased
  } finally {
    await f.close();
  }
});

test('P2: a duplicate remove delivery (same occurrence time, different delivery id) is an idempotent no-op', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const removedAt = new Date().toISOString();
    await postWebhook(
      f,
      removePayload({
        type: 'Issue',
        dataId: source.ids.issue,
        organizationId: source.ids.org,
        createdAt: removedAt,
      }),
      'linear-webhook-secret',
    );
    await runLinearSyncWorker(f.db, f.env, { fetcher: removeOnlyFetcher(source.ids.org) });
    const firstMapping = await sourceMapRow(f, 'issues', source.ids.issue);
    expect(firstMapping.source_deleted_at).toBe(removedAt);

    // A second, independently-delivered remove for the SAME occurrence -- Linear itself
    // resending after a timeout, or a replayed webhook with a fresh delivery id.
    await postWebhook(
      f,
      removePayload({
        type: 'Issue',
        dataId: source.ids.issue,
        organizationId: source.ids.org,
        createdAt: removedAt,
      }),
      'linear-webhook-secret',
    );
    const result = await runLinearSyncWorker(f.db, f.env, {
      fetcher: removeOnlyFetcher(source.ids.org),
    });
    expect(result).toEqual({ processed: 1, blocked: 0, failed: 0 }); // claimed and marked done, applied nothing
    const secondMapping = await sourceMapRow(f, 'issues', source.ids.issue);
    expect(secondMapping.source_deleted_at).toBe(removedAt); // unchanged, not re-applied
    expect(secondMapping.last_removed_at).toBe(removedAt);
  } finally {
    await f.close();
  }
});

test('P2: a changed-body replay of a remove delivery id is recorded as a mismatch, the original is never overwritten', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const deliveryId = crypto.randomUUID();
    const first = removePayload({
      type: 'Issue',
      dataId: source.ids.issue,
      organizationId: source.ids.org,
    });
    const receivedFirst = await postWebhook(f, first, 'linear-webhook-secret', { deliveryId });
    expect(receivedFirst.data.duplicate).toBe(false);
    const second = { ...first, createdAt: new Date(Date.now() + 5000).toISOString() };
    const receivedSecond = await postWebhook(f, second, 'linear-webhook-secret', { deliveryId });
    expect(receivedSecond.data.duplicate).toBe(true);
    expect(receivedSecond.data.mismatch).toBe(true);
    const mismatches = await f.db.transaction((tx) =>
      tx.all(
        'SELECT * FROM linear_webhook_inbox_mismatches WHERE workspace_id=? AND delivery_id=?',
        [f.init.workspace_id, deliveryId],
      ),
    );
    expect(mismatches).toHaveLength(1);
    const stored = await inboxRow(f, deliveryId);
    expect(JSON.parse(stored.payload).createdAt).toBe(first.createdAt); // original, never overwritten
  } finally {
    await f.close();
  }
});

test('P2: a late remove replay after an implicit restore must not re-remove the restored item', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const issueKey = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const t1 = new Date(Date.now() - 120000).toISOString();
    const t3 = new Date(Date.now() - 60000).toISOString();
    await postWebhook(
      f,
      removePayload({
        type: 'Issue',
        dataId: source.ids.issue,
        organizationId: source.ids.org,
        createdAt: t1,
      }),
      'linear-webhook-secret',
    );
    await runLinearSyncWorker(f.db, f.env, { fetcher: removeOnlyFetcher(source.ids.org) });
    expect((await sourceMapRow(f, 'issues', source.ids.issue)).source_deleted_at).toBe(t1);

    // An ordinary update, newer than the remove: this IS the restore signal.
    const restoredRecord = { ...source.data.issues[1], priority: 4, updatedAt: t3 };
    await postWebhook(
      f,
      linearWebhookPayload({
        type: 'Issue',
        action: 'update',
        dataId: source.ids.issue,
        organizationId: source.ids.org,
      }),
      'linear-webhook-secret',
    );
    const restoreResult = await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        issuesById: { [source.ids.issue]: restoredRecord },
      }),
    });
    expect(restoreResult).toEqual({ processed: 1, blocked: 0, failed: 0 });
    const restoredMapping = await sourceMapRow(f, 'issues', source.ids.issue);
    expect(restoredMapping.source_deleted_at).toBeNull();
    expect(restoredMapping.restored_at).toBe(t3);
    const afterRestore = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(afterRestore.data.priority).toBe(4);

    // A delayed duplicate of the ORIGINAL remove (createdAt=t1) finally arrives, after the
    // restore already happened. t1 is stale relative to the restore's own updatedAt (t3):
    // it must be a no-op, never re-applying the marker.
    await postWebhook(
      f,
      removePayload({
        type: 'Issue',
        dataId: source.ids.issue,
        organizationId: source.ids.org,
        createdAt: t1,
      }),
      'linear-webhook-secret',
    );
    const lateResult = await runLinearSyncWorker(f.db, f.env, {
      fetcher: removeOnlyFetcher(source.ids.org),
    });
    expect(lateResult).toEqual({ processed: 1, blocked: 0, failed: 0 }); // claimed, no-op
    const finalMapping = await sourceMapRow(f, 'issues', source.ids.issue);
    expect(finalMapping.source_deleted_at).toBeNull(); // still restored, never re-removed
    expect(finalMapping.restored_at).toBe(t3);
    const stillRestored = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(stillRestored.data.priority).toBe(4); // untouched by the stale remove
  } finally {
    await f.close();
  }
});

test('P2: a stale update after a remove must not resurrect the item', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const issueKey = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const t0 = new Date(Date.now() - 180000).toISOString();
    const t1 = new Date(Date.now() - 120000).toISOString();
    const t2 = new Date(Date.now() - 60000).toISOString();

    // Establish a real source_updated_at=t0 baseline via a genuine prior update.
    const baselineRecord = { ...source.data.issues[1], priority: 3, updatedAt: t0 };
    await postWebhook(
      f,
      linearWebhookPayload({
        type: 'Issue',
        action: 'update',
        dataId: source.ids.issue,
        organizationId: source.ids.org,
      }),
      'linear-webhook-secret',
    );
    await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        issuesById: { [source.ids.issue]: baselineRecord },
      }),
    });
    const afterBaseline = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(afterBaseline.data.priority).toBe(3);

    // Remove at t2 (newer than t0).
    await postWebhook(
      f,
      removePayload({
        type: 'Issue',
        dataId: source.ids.issue,
        organizationId: source.ids.org,
        createdAt: t2,
      }),
      'linear-webhook-secret',
    );
    await runLinearSyncWorker(f.db, f.env, { fetcher: removeOnlyFetcher(source.ids.org) });
    expect((await sourceMapRow(f, 'issues', source.ids.issue)).source_deleted_at).toBe(t2);

    // A stale update at t1 (t0 < t1 < t2): newer than the last applied state (so it is not
    // itself STALE_DELIVERY), but OLDER than the remove -- must be a no-op, not a restore.
    const staleRecord = { ...source.data.issues[1], priority: 9, updatedAt: t1 };
    await postWebhook(
      f,
      linearWebhookPayload({
        type: 'Issue',
        action: 'update',
        dataId: source.ids.issue,
        organizationId: source.ids.org,
      }),
      'linear-webhook-secret',
    );
    const staleResult = await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        issuesById: { [source.ids.issue]: staleRecord },
      }),
    });
    expect(staleResult).toEqual({ processed: 1, blocked: 0, failed: 0 }); // claimed, no-op
    const afterStale = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(afterStale.data.priority).toBe(3); // unchanged: the stale update never applied
    expect(afterStale.data.version).toBe(afterBaseline.data.version); // no write happened
    const mapping = await sourceMapRow(f, 'issues', source.ids.issue);
    expect(mapping.source_deleted_at).toBe(t2); // still removed
    expect(mapping.restored_at).toBeNull(); // never resurrected
  } finally {
    await f.close();
  }
});

test('P2: a remove for a source id that was never imported/mapped creates a receipt only, never a native row', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const neverImportedId = crypto.randomUUID();
    const removedAt = new Date().toISOString();
    await postWebhook(
      f,
      removePayload({
        type: 'Issue',
        dataId: neverImportedId,
        organizationId: source.ids.org,
        createdAt: removedAt,
      }),
      'linear-webhook-secret',
    );
    const result = await runLinearSyncWorker(f.db, f.env, {
      fetcher: removeOnlyFetcher(source.ids.org),
    });
    expect(result).toEqual({ processed: 1, blocked: 0, failed: 0 });
    const mapping = await f.db.transaction((tx) =>
      tx.one(
        'SELECT * FROM linear_source_map WHERE workspace_id=? AND collection=? AND source_id=?',
        [f.init.workspace_id, 'issues', neverImportedId],
      ),
    );
    expect(mapping).toBeNull(); // never fabricated a mapping/native row
    const receipt = await f.db.transaction((tx) =>
      tx.one(
        'SELECT * FROM linear_removal_receipts WHERE workspace_id=? AND collection=? AND source_id=?',
        [f.init.workspace_id, 'issues', neverImportedId],
      ),
    );
    expect(receipt.removed_at).toBe(removedAt);
  } finally {
    await f.close();
  }
});

test('P2: a malformed remove event timestamp is rejected, never applied', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const issueKey = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const before = await f.request('GET', '/api/v1/issues/' + issueKey);
    const deliveryId = crypto.randomUUID();
    await postWebhook(
      f,
      removePayload({
        type: 'Issue',
        dataId: source.ids.issue,
        organizationId: source.ids.org,
        createdAt: 'not-a-real-timestamp',
      }),
      'linear-webhook-secret',
      { deliveryId },
    );
    const result = await runLinearSyncWorker(f.db, f.env, {
      fetcher: removeOnlyFetcher(source.ids.org),
    });
    expect(result).toEqual({ processed: 0, blocked: 1, failed: 0 });
    const row = await inboxRow(f, deliveryId);
    expect(row.status).toBe('blocked');
    expect(row.last_error).toBe('MALFORMED_SOURCE_PAYLOAD');
    const after = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(after.data).toEqual(before.data);
    const mapping = await sourceMapRow(f, 'issues', source.ids.issue);
    expect(mapping.source_deleted_at).toBeNull();
  } finally {
    await f.close();
  }
});

// Proves the remove path was never accidentally merged with the pre-existing blocked-read
// path: an UPDATE whose hydration read comes back absent is STILL just a blocked update
// (SOURCE_READ_BLOCKED), exactly as before P2, never treated as a deletion signal.
test('P2: an UPDATE with a blocked/absent hydration read is still just blocked, never inferred as a removal', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const issueKey = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const before = await f.request('GET', '/api/v1/issues/' + issueKey);
    const deliveryId = crypto.randomUUID();
    await postWebhook(
      f,
      linearWebhookPayload({
        type: 'Issue',
        action: 'update',
        dataId: source.ids.issue,
        organizationId: source.ids.org,
      }),
      'linear-webhook-secret',
      { deliveryId },
    );
    const result = await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({ organizationId: source.ids.org, issuesById: {} }), // absent read
    });
    expect(result).toEqual({ processed: 0, blocked: 1, failed: 0 });
    const row = await inboxRow(f, deliveryId);
    expect(row.last_error).toBe('SOURCE_READ_BLOCKED');
    const after = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(after.data).toEqual(before.data);
    const mapping = await sourceMapRow(f, 'issues', source.ids.issue);
    expect(mapping.source_deleted_at).toBeNull(); // never tombstoned by an absent read
  } finally {
    await f.close();
  }
});

test('P2: a local edit that diverged before a verified remove arrives is recorded as a sticky conflict; native content retained', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const issueKey = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const detail = await f.request('GET', '/api/v1/issues/' + issueKey);
    const editedTitle = 'Edited locally, then the source was deleted';
    const edited = await f.request('PATCH', '/api/v1/issues/' + issueKey, {
      title: editedTitle,
      version: detail.data.version,
    });
    expect(edited.status).toBe(200);
    const removedAt = new Date().toISOString();
    await postWebhook(
      f,
      removePayload({
        type: 'Issue',
        dataId: source.ids.issue,
        organizationId: source.ids.org,
        createdAt: removedAt,
      }),
      'linear-webhook-secret',
    );
    const result = await runLinearSyncWorker(f.db, f.env, {
      fetcher: removeOnlyFetcher(source.ids.org),
    });
    expect(result).toEqual({ processed: 1, blocked: 0, failed: 0 });
    const after = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(after.data.title).toBe(editedTitle); // local content retained, never erased
    const conflicts = await f.db.transaction((tx) =>
      tx.all(
        "SELECT * FROM linear_sync_conflicts WHERE workspace_id=? AND source_id=? AND field='__source_removed__'",
        [f.init.workspace_id, source.ids.issue],
      ),
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].resolved_at).toBeNull();
    expect(conflicts[0].remote_value).toBe(JSON.stringify(removedAt));
  } finally {
    await f.close();
  }
});

test('P2: child issues and comments survive a parent issue removal completely untouched', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const childKey = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.child);
    const commentIssueKey = targetId(
      f.init.workspace_id,
      source.ids.org,
      'issues',
      source.ids.issue,
    );
    const beforeChild = await f.request('GET', '/api/v1/issues/' + childKey);
    // Comments are embedded on the issue detail response (getIssue/issueDetails), not a
    // separate endpoint -- see packages/server/modules/tickets/service.mjs.
    const beforeParent = await f.request('GET', '/api/v1/issues/' + commentIssueKey);
    expect(beforeParent.data.comments).toHaveLength(1);
    await postWebhook(
      f,
      removePayload({
        type: 'Issue',
        dataId: source.ids.issue, // the PARENT is removed, not the child
        organizationId: source.ids.org,
      }),
      'linear-webhook-secret',
    );
    const result = await runLinearSyncWorker(f.db, f.env, {
      fetcher: removeOnlyFetcher(source.ids.org),
    });
    expect(result).toEqual({ processed: 1, blocked: 0, failed: 0 });
    const afterChild = await f.request('GET', '/api/v1/issues/' + childKey);
    expect(afterChild.data).toEqual(beforeChild.data); // untouched: no cascade
    const afterParent = await f.request('GET', '/api/v1/issues/' + commentIssueKey);
    expect(afterParent.data.comments).toEqual(beforeParent.data.comments); // untouched: no cascade
  } finally {
    await f.close();
  }
});

test('P2: a transaction rollback during remove application leaves the inbox row retryable; the marker is never set', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const deliveryId = crypto.randomUUID();
    await postWebhook(
      f,
      removePayload({
        type: 'Issue',
        dataId: source.ids.issue,
        organizationId: source.ids.org,
      }),
      'linear-webhook-secret',
      { deliveryId },
    );
    const original = f.db.transaction.bind(f.db);
    let armed = false;
    f.db.transaction = (fn, options) =>
      original(async (tx) => {
        const wrapped = {
          ...tx,
          exec: async (sql, args) => {
            if (armed && sql.startsWith('UPDATE linear_source_map SET source_deleted_at'))
              throw new Error('Simulated crash mid-write');
            return tx.exec(sql, args);
          },
        };
        return fn(wrapped);
      }, options);
    armed = true;
    const result = await runLinearSyncWorker(f.db, f.env, {
      fetcher: removeOnlyFetcher(source.ids.org),
    });
    f.db.transaction = original;
    expect(result.failed).toBe(1);
    const row = await inboxRow(f, deliveryId);
    expect(['pending', 'processing']).toContain(row.status);
    expect(row.attempts).toBe(1);
    const mapping = await sourceMapRow(f, 'issues', source.ids.issue);
    expect(mapping.source_deleted_at).toBeNull(); // the failed write never committed
  } finally {
    await f.close();
  }
});

test('P2: claimNextInboxRow, applyInboxRow and recordFailure pass the IDENTICAL tx.lock key for a remove delivery too', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    // A malformed timestamp guarantees the delivery reaches recordFailure (blocked),
    // exercising the SAME lock-key contract as R3 finding 1, on the remove code path.
    await postWebhook(
      f,
      removePayload({
        type: 'Issue',
        dataId: source.ids.issue,
        organizationId: source.ids.org,
        createdAt: 'not-a-real-timestamp',
      }),
      'linear-webhook-secret',
    );
    const lockKeys = [];
    const original = f.db.transaction.bind(f.db);
    const spyDb = {
      transaction: (fn, options) =>
        original((tx) => {
          const spyTx = {
            ...tx,
            lock: async (key) => {
              lockKeys.push(key);
              return tx.lock(key);
            },
          };
          return fn(spyTx);
        }, options),
    };
    const result = await runLinearSyncWorker(spyDb, f.env, {
      fetcher: removeOnlyFetcher(source.ids.org),
    });
    expect(result).toEqual({ processed: 0, blocked: 1, failed: 0 });
    expect(lockKeys.length).toBeGreaterThanOrEqual(3);
    expect(new Set(lockKeys).size).toBe(1);
    expect(lockKeys[0]).toBe(`tickets-app:linear-sync:worker:${f.init.workspace_id}`);
  } finally {
    await f.close();
  }
});

test('a brand-new Linear issue gets a distinct native key on collision without changing the existing issue', async () => {
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
    expect(collisionResult).toEqual({ processed: 1, blocked: 0, failed: 0 });
    const collisionRow = await inboxRow(f, collidingDelivery);
    expect(collisionRow.status).toBe('done');
    expect(collisionRow.last_error).toBeNull();
    const distinct = await f.request(
      'GET',
      '/api/v1/issues/' +
        targetId(f.init.workspace_id, source.ids.org, 'issues', collidingSourceId),
    );
    expect(distinct.data.key).toBe('SRC-10');
    expect(distinct.data.title).toBe(colliding.title);
    const retainedLocal = await f.request('GET', '/api/v1/issues/' + local.data.id);
    expect(retainedLocal.data.key).toBe('SRC-9');
    expect(retainedLocal.data.title).toBe('Local new one');
    expect(retainedLocal.data.version).toBe(1);
    const teamAfterCollision = await f.db.transaction((tx) =>
      tx.one('SELECT next_number FROM teams WHERE workspace_id=? AND id=?', [
        f.init.workspace_id,
        srcTeamId,
      ]),
    );
    expect(teamAfterCollision.next_number).toBe(11); // source and native issues remain distinct

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

// finding B (conflict resolution): the admin's resolution must reference the version they
// actually reviewed. A local edit landing between "the conflict was surfaced" and "the
// admin resolved it" must be rejected, not silently erased by applying a now-stale remote
// value on top of it.
test('finding B: resolving a conflict against a stale version is rejected, never silently applied', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const issueKey = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const detail = await f.request('GET', '/api/v1/issues/' + issueKey);
    const localTitle = 'Local edit before the conflicting remote change';
    const edited = await f.request('PATCH', '/api/v1/issues/' + issueKey, {
      title: localTitle,
      version: detail.data.version,
    });
    expect(edited.status).toBe(200);

    const remoteRecord = {
      ...source.data.issues[1],
      title: 'Renamed in Linear (genuine conflict)',
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
    const afterConflict = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(afterConflict.data.title).toBe(localTitle); // conflict kept local, recorded

    const conflicts = await f.request('GET', '/api/v1/sync/linear/conflicts');
    expect(conflicts.data).toHaveLength(1);
    const conflictId = conflicts.data[0].id;
    // The admin "reviewed" the conflict at this version...
    const reviewedVersion = afterConflict.data.version;

    // ...but a NEW local edit lands before they click resolve.
    const raceTitle = 'Second local edit, landed after the admin reviewed the conflict';
    const raced = await f.request('PATCH', '/api/v1/issues/' + issueKey, {
      title: raceTitle,
      version: reviewedVersion,
    });
    expect(raced.status).toBe(200);

    const stale = await f.request('POST', `/api/v1/sync/linear/conflicts/${conflictId}/resolve`, {
      resolution: 'applied_remote',
      expected_version: reviewedVersion,
    });
    expect(stale.status).toBe(409);
    expect(stale.data.error.code).toBe('VERSION_RACE');
    const untouched = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(untouched.data.title).toBe(raceTitle); // the race edit survives, remote never applied
    const stillOpen = await f.request('GET', '/api/v1/sync/linear/conflicts');
    expect(stillOpen.data).toHaveLength(1);
    expect(stillOpen.data[0].resolved_at).toBeNull(); // never silently resolved

    // Resolving against the CURRENT (correct) version succeeds.
    const applied = await f.request('POST', `/api/v1/sync/linear/conflicts/${conflictId}/resolve`, {
      resolution: 'applied_remote',
      expected_version: untouched.data.version,
    });
    expect(applied.status).toBe(200);
    const afterApplied = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(afterApplied.data.title).toBe(remoteRecord.title);
  } finally {
    await f.close();
  }
});

// finding B: a conflict on a field with no real column (label_ids, trashed) must be
// explicitly rejected as unsupported, never attempted as a raw (and invalid) column write.
test('finding B: an unsupported conflict field (label_ids) is rejected 422, never written as a raw column', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const issueKey = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const detail = await f.request('GET', '/api/v1/issues/' + issueKey);
    await f.db.transaction((tx) =>
      tx.one('SELECT id FROM issues WHERE workspace_id=? AND id=?', [
        f.init.workspace_id,
        detail.data.id,
      ]),
    );
    const fakeConflictId = crypto.randomUUID();
    await f.db.transaction((tx) =>
      tx.exec(
        'INSERT INTO linear_sync_conflicts(id,workspace_id,collection,source_id,target_id,field,baseline_value,local_value,remote_value,detected_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        [
          fakeConflictId,
          f.init.workspace_id,
          'issues',
          source.ids.issue,
          detail.data.id,
          'label_ids',
          '[]',
          '[]',
          '["some-label"]',
          new Date().toISOString(),
        ],
      ),
    );
    const resolve = await f.request(
      'POST',
      `/api/v1/sync/linear/conflicts/${fakeConflictId}/resolve`,
      { resolution: 'applied_remote', expected_version: detail.data.version },
    );
    expect(resolve.status).toBe(422);
    expect(resolve.data.error.code).toBe('UNSUPPORTED_RESOLUTION');
    const stillOpen = await f.db.transaction((tx) =>
      tx.one('SELECT resolved_at FROM linear_sync_conflicts WHERE id=?', [fakeConflictId]),
    );
    expect(stillOpen.resolved_at).toBeNull();
  } finally {
    await f.close();
  }
});

// --- Independent end-to-end reproduction: findings 2, 5 and 6 together -----------------
//
// Sequence: initial import -> locally assign a real member as owner and change the title ->
// deliver a new SIGNED Issue-update webhook with a conflicting remote title TWICE (same
// conflicting title, delivered twice) -> then a HTTP 200 GraphQL response with a FORBIDDEN
// error for that issue. All four outcomes below must be preserved=true.
test('repro: sticky conflict baseline, real-member assignment and a permission error all survive repeated/adjacent deliveries', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const issueKey = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const before = await f.request('GET', '/api/v1/issues/' + issueKey);
    const localTitle = 'Local title, assigned to a real member';
    const assigned = await f.request('PATCH', '/api/v1/issues/' + issueKey, {
      title: localTitle,
      assignee_id: f.init.user_id,
      version: before.data.version,
    });
    expect(assigned.status).toBe(200);
    expect(assigned.data.assignee_id).toBe(f.init.user_id);

    const remoteRecord = {
      ...source.data.issues[1],
      title: 'Renamed remotely',
      updatedAt: new Date().toISOString(),
    };
    const conflictFetcher = fakeLinearTransport({
      organizationId: source.ids.org,
      issuesById: { [source.ids.issue]: remoteRecord },
    });

    // First delivery: a genuine double-edit (local title changed, remote title changed to
    // a different value) -> conflict, local title kept.
    const payload1 = linearWebhookPayload({
      type: 'Issue',
      action: 'update',
      dataId: source.ids.issue,
      organizationId: source.ids.org,
    });
    await postWebhook(f, payload1, 'linear-webhook-secret');
    const result1 = await runLinearSyncWorker(f.db, f.env, { fetcher: conflictFetcher });
    expect(result1).toEqual({ processed: 1, blocked: 0, failed: 0 });
    const afterFirst = await f.request('GET', '/api/v1/issues/' + issueKey);
    const firstConflictPreserved = afterFirst.data.title === localTitle;

    // Second delivery: the SAME conflicting remote title again, but with a strictly LATER
    // updatedAt (a different hash) so this genuinely re-runs the merge instead of hitting
    // the unchanged-remote-hash no-op. The sticky conflict baseline stored after the first
    // delivery must be remote-normalized (finding 5), not the merged/kept-local result --
    // otherwise this second delivery looks like "remote changed the field AGAIN" and
    // silently overwrites the local title.
    const remoteRecord2 = { ...remoteRecord, updatedAt: new Date(Date.now() + 1000).toISOString() };
    const conflictFetcher2 = fakeLinearTransport({
      organizationId: source.ids.org,
      issuesById: { [source.ids.issue]: remoteRecord2 },
    });
    const payload2 = linearWebhookPayload({
      type: 'Issue',
      action: 'update',
      dataId: source.ids.issue,
      organizationId: source.ids.org,
    });
    await postWebhook(f, payload2, 'linear-webhook-secret');
    const result2 = await runLinearSyncWorker(f.db, f.env, { fetcher: conflictFetcher2 });
    expect(result2).toEqual({ processed: 1, blocked: 0, failed: 0 });
    const afterSecond = await f.request('GET', '/api/v1/issues/' + issueKey);
    const repeatedConflictPreserved = afterSecond.data.title === localTitle;
    const assigneePreserved = afterSecond.data.assignee_id === f.init.user_id;

    // Third delivery: Linear returns an HTTP 200 response carrying a FORBIDDEN GraphQL
    // error for this issue. This must never be read as "the issue was deleted" (finding
    // 2) -- it must block the delivery and leave the native row completely untouched.
    const payload3 = linearWebhookPayload({
      type: 'Issue',
      action: 'update',
      dataId: source.ids.issue,
      organizationId: source.ids.org,
    });
    const deliveryId3 = crypto.randomUUID();
    await postWebhook(f, payload3, 'linear-webhook-secret', { deliveryId: deliveryId3 });
    const forbiddenFetcher = async (url, options) => {
      const body = JSON.parse(options.body);
      if (body.query.includes('organization {'))
        return jsonResponse({ data: { organization: { id: source.ids.org } } });
      if (body.query.includes('issue(id'))
        return jsonResponse({
          data: { issue: null },
          errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }],
        });
      throw new Error('Unexpected query for the FORBIDDEN scenario: ' + body.query);
    };
    await runLinearSyncWorker(f.db, f.env, { fetcher: forbiddenFetcher });
    const row3 = await inboxRow(f, deliveryId3);
    const afterThird = await f.request('GET', '/api/v1/issues/' + issueKey);
    const permissionErrorPreserved = afterThird.status === 200 && !afterThird.data.deleted_at;

    expect({
      firstConflictPreserved,
      assigneePreserved,
      repeatedConflictPreserved,
      permissionErrorPreserved,
    }).toEqual({
      firstConflictPreserved: true,
      assigneePreserved: true,
      repeatedConflictPreserved: true,
      permissionErrorPreserved: true,
    });
    expect(row3.status).toBe('blocked'); // never 'done', never tombstoned as not_found
  } finally {
    await f.close();
  }
});

// finding 6: unrelated remote changes must never clear a real (native) member assignment.
test('finding 6: a real member assigned locally survives an unrelated remote title-only update', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const issueKey = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const before = await f.request('GET', '/api/v1/issues/' + issueKey);
    const assigned = await f.request('PATCH', '/api/v1/issues/' + issueKey, {
      assignee_id: f.init.user_id,
      version: before.data.version,
    });
    expect(assigned.status).toBe(200);
    expect(assigned.data.assignee_id).toBe(f.init.user_id);

    const remoteRecord = {
      ...source.data.issues[1],
      title: 'Title-only remote change, nothing about the assignee',
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
    expect(after.data.title).toBe(remoteRecord.title); // the unrelated remote change DID apply
    expect(after.data.assignee_id).toBe(f.init.user_id); // the real member assignment survives
  } finally {
    await f.close();
  }
});

// finding 9: two invocations of reconcile with maxPages=1 must hold a FIXED pass lower
// bound (never narrowed per-page) and the union of both invocations' pages must cover
// every row, including a same-timestamp boundary row that a `gt`-narrowed filter would
// otherwise silently exclude on the second invocation.
test('finding 9: two reconcile invocations hold a fixed pass lower bound; nothing at the page boundary is silently skipped', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const idA = crypto.randomUUID(),
      idB = crypto.randomUUID();
    const T1 = new Date(Date.now() + 60000).toISOString();
    // idA and idB share the EXACT SAME updatedAt: the boundary case where a per-page
    // watermark advance (finding 9's bug) would silently drop idB on the next invocation,
    // because a `gt` filter narrowed to T1 excludes anything AT T1 too.
    const allRows = [
      { id: idA, updatedAt: T1 },
      { id: idB, updatedAt: T1 },
    ];
    const issueCalls = [];
    const fetcher = async (url, options) => {
      const body = JSON.parse(options.body);
      if (body.query.includes('organization {'))
        return new Response(JSON.stringify({ data: { organization: { id: source.ids.org } } }), {
          status: 200,
        });
      if (body.query.includes('comments('))
        return new Response(
          JSON.stringify({
            data: { comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } },
          }),
          { status: 200 },
        );
      if (body.query.includes('issues(')) {
        issueCalls.push(body);
        const updatedAfter = body.variables.updatedAfter;
        // Real-API-like filtering: only rows strictly newer than the requested bound.
        const eligible = allRows.filter((r) => !updatedAfter || r.updatedAt > updatedAfter);
        const afterIndex = body.variables.after ? Number(body.variables.after) : 0;
        const node = eligible[afterIndex];
        const hasNextPage = afterIndex + 1 < eligible.length;
        return new Response(
          JSON.stringify({
            data: {
              issues: {
                pageInfo: { hasNextPage, endCursor: hasNextPage ? String(afterIndex + 1) : null },
                nodes: node ? [node] : [],
              },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error('Unexpected query: ' + body.query);
    };

    const first = await reconcileLinearWorkspace(f.db, f.env, { fetcher, maxPages: 1 });
    expect(first.issues.pages).toBe(1);
    const second = await reconcileLinearWorkspace(f.db, f.env, { fetcher, maxPages: 1 });
    expect(second.issues.pages).toBe(1);

    const filtersUsed = issueCalls.map((c) => c.variables.updatedAfter);
    expect(filtersUsed[0]).toBe(filtersUsed[1]); // fixed pass lower bound across both invocations

    const enqueued = await f.db.transaction((tx) =>
      tx.all(
        "SELECT delivery_id FROM linear_webhook_inbox WHERE workspace_id=? AND resource_type='Issue' AND delivery_id LIKE 'reconcile:%'",
        [f.init.workspace_id],
      ),
    );
    const ids = enqueued.map((r) => r.delivery_id);
    expect(ids.some((d) => d.includes(idA))).toBe(true);
    expect(ids.some((d) => d.includes(idB))).toBe(true); // the boundary-duplicate row was NOT skipped
  } finally {
    await f.close();
  }
});

// finding 1: claimNextInboxRow, applyInboxRow and recordFailure must all lock the SAME
// key. SQLite's tx.lock is a no-op (the whole database is already globally mutexed), so a
// mismatched key is invisible there -- this test enforces the invariant structurally, by
// capturing the literal key each call site passes, independent of that accidental mutex.
test('R3 finding 1: claimNextInboxRow, applyInboxRow and recordFailure all pass the IDENTICAL tx.lock key', async () => {
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
    await postWebhook(f, payload, 'linear-webhook-secret');

    const lockKeys = [];
    const original = f.db.transaction.bind(f.db);
    const spyDb = {
      transaction: (fn, options) =>
        original((tx) => {
          const spyTx = {
            ...tx,
            lock: async (key) => {
              lockKeys.push(key);
              return tx.lock(key);
            },
          };
          return fn(spyTx);
        }, options),
    };

    const result = await runLinearSyncWorker(spyDb, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        issuesById: { [source.ids.issue]: remoteRecord },
      }),
    });
    expect(result).toEqual({ processed: 0, blocked: 1, failed: 0 });
    // claimNextInboxRow's lock, applyInboxRow's lock (before it throws MISSING_REFERENCE),
    // and recordFailure's lock must all be the SAME key -- a mismatch (e.g. the bare
    // workspace id instead of the worker-scoped key) would not serialize claim against
    // apply/failure on Postgres, breaking claim fencing on any real deployment.
    expect(lockKeys.length).toBeGreaterThanOrEqual(3);
    expect(new Set(lockKeys).size).toBe(1);
    expect(lockKeys[0]).toBe(`tickets-app:linear-sync:worker:${f.init.workspace_id}`);
  } finally {
    await f.close();
  }
});

// finding 3: a source issue currently reported as trashed is a conservative SAFETY block,
// NOT deletion support -- the whole delivery is blocked, no field applies, deleted_at is
// never written. Real removal semantics remain explicit future work.
test('R3 finding 3: a remote UPDATE reporting the issue as trashed blocks the whole delivery; no partial write, deleted_at untouched', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const issueKey = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const before = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(before.data.deleted_at ?? null).toBeNull();
    const remoteRecord = {
      ...source.data.issues[1],
      title: 'This title change must NOT apply either',
      priority: 4,
      trashed: true,
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
    expect(row.last_error).toBe('SOURCE_TRASHED_UNSUPPORTED');
    const after = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(after.data).toEqual(before.data); // completely untouched: no partial write at all
  } finally {
    await f.close();
  }
});
test('R3 finding 3: a pre-trashed source issue blocks on CREATE too, never creating an invisible row', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const freshSourceId = crypto.randomUUID();
    const fresh = fakeIssueRecord({
      id: freshSourceId,
      identifier: 'SRC-20',
      number: 20,
      team: { id: source.ids.team },
      state: { id: source.ids.state },
      trashed: true,
    });
    const payload = linearWebhookPayload({
      type: 'Issue',
      action: 'create',
      dataId: freshSourceId,
      organizationId: source.ids.org,
    });
    const deliveryId = crypto.randomUUID();
    await postWebhook(f, payload, 'linear-webhook-secret', { deliveryId });
    const result = await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        issuesById: { [freshSourceId]: fresh },
      }),
    });
    expect(result).toEqual({ processed: 0, blocked: 1, failed: 0 });
    const row = await inboxRow(f, deliveryId);
    expect(row.status).toBe('blocked');
    expect(row.last_error).toBe('SOURCE_TRASHED_UNSUPPORTED');
    const createdKey = targetId(f.init.workspace_id, source.ids.org, 'issues', freshSourceId);
    const created = await f.request('GET', '/api/v1/issues/' + createdKey);
    expect(created.status).toBe(404); // never created, not even hidden/invisible
  } finally {
    await f.close();
  }
});

// finding 4: a stale updatedAt and an optimistic-lock version race are plausibly
// self-resolving (replica lag/clock skew, an ordinary concurrent edit) -- both must be
// TRANSIENT (pending + backoff, eventually 'failed' after 8 attempts), never terminal
// 'blocked' requiring an admin on the very first collision.
test('R3 finding 4: a stale delivery and a version race are transient (pending+backoff), never terminal blocked', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const payload = linearWebhookPayload({
      type: 'Issue',
      action: 'update',
      dataId: source.ids.issue,
      organizationId: source.ids.org,
    });

    // First, a normal successful delivery -- establishes mapping.source_updated_at.
    const remoteRecord = {
      ...source.data.issues[1],
      priority: 3,
      updatedAt: new Date().toISOString(),
    };
    await postWebhook(f, payload, 'linear-webhook-secret');
    const first = await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        issuesById: { [source.ids.issue]: remoteRecord },
      }),
    });
    expect(first).toEqual({ processed: 1, blocked: 0, failed: 0 });

    // A second delivery whose hydrated updatedAt is OLDER than what's already applied.
    const staleRecord = {
      ...remoteRecord,
      priority: 1,
      updatedAt: new Date(Date.now() - 3600000).toISOString(),
    };
    const staleDeliveryId = crypto.randomUUID();
    await postWebhook(f, payload, 'linear-webhook-secret', { deliveryId: staleDeliveryId });
    const staleResult = await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        issuesById: { [source.ids.issue]: staleRecord },
      }),
    });
    expect(staleResult).toEqual({ processed: 0, blocked: 0, failed: 1 });
    const staleRow = await inboxRow(f, staleDeliveryId);
    expect(staleRow.status).toBe('pending'); // transient, not terminal
    expect(Date.parse(staleRow.next_attempt_at)).toBeGreaterThan(Date.now());
    expect(staleRow.last_error).toBe('STALE_DELIVERY');

    // A version race: force the UPDATE's optimistic-lock WHERE clause to match 0 rows.
    const raceDeliveryId = crypto.randomUUID();
    await postWebhook(f, payload, 'linear-webhook-secret', { deliveryId: raceDeliveryId });
    const raceRecord = {
      ...remoteRecord,
      priority: 2,
      updatedAt: new Date(Date.now() + 1000).toISOString(),
    };
    const original = f.db.transaction.bind(f.db);
    let armed = false;
    f.db.transaction = (fn, options) =>
      original(async (tx) => {
        const wrapped = {
          ...tx,
          exec: async (sql, args) => {
            if (armed && sql.startsWith('UPDATE issues SET')) {
              armed = false;
              return { changes: 0 }; // simulate: a concurrent local edit won the race
            }
            return tx.exec(sql, args);
          },
        };
        return fn(wrapped);
      }, options);
    armed = true;
    const raceResult = await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        issuesById: { [source.ids.issue]: raceRecord },
      }),
    });
    f.db.transaction = original;
    expect(raceResult).toEqual({ processed: 0, blocked: 0, failed: 1 });
    const raceRow = await inboxRow(f, raceDeliveryId);
    expect(raceRow.status).toBe('pending'); // transient, not terminal
    expect(raceRow.last_error).toBe('VERSION_RACE');

    // After enough attempts, a transient failure eventually becomes terminal 'failed' --
    // bounded, not stuck retrying forever, but not requiring immediate admin action either.
    const staleRowId = (await inboxRow(f, staleDeliveryId)).id;
    await f.db.transaction((tx) =>
      tx.exec('UPDATE linear_webhook_inbox SET attempts=?,next_attempt_at=? WHERE id=?', [
        8,
        new Date(0).toISOString(),
        staleRowId,
      ]),
    );
    await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        issuesById: { [source.ids.issue]: staleRecord },
      }),
    });
    const exhausted = await inboxRow(f, staleDeliveryId);
    expect(exhausted.status).toBe('failed');
  } finally {
    await f.close();
  }
});

// finding 5: linear_imports has no field recording the SOURCE snapshot's actual export
// cutoff (only created_at, when staging started, and completed_at, when apply finished).
// The first catch-up pass must bootstrap from created_at (a conservative lower bound
// covering the whole staging-to-completion window) with an INCLUSIVE (gte) comparison, so
// a same-timestamp boundary row and a row changed between created_at and completed_at are
// never silently invisible.
test('R3 finding 5: the first reconcile pass includes a row changed before import completed_at and a same-timestamp boundary row', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const importCreatedAt = new Date(Date.now() - 3600000).toISOString();
    const importCompletedAt = new Date(Date.now() - 60000).toISOString();
    await f.db.transaction((tx) =>
      tx.exec(
        'UPDATE linear_imports SET created_at=?,completed_at=? WHERE workspace_id=? AND source_workspace_id=?',
        [importCreatedAt, importCompletedAt, f.init.workspace_id, source.ids.org],
      ),
    );

    const preCompletionId = crypto.randomUUID();
    const preCompletionUpdatedAt = new Date(Date.now() - 1800000).toISOString(); // between created_at and completed_at
    let capturedUpdatedAfter = null;
    const fetcher = async (url, options) => {
      const body = JSON.parse(options.body);
      if (body.query.includes('organization {'))
        return new Response(JSON.stringify({ data: { organization: { id: source.ids.org } } }), {
          status: 200,
        });
      if (body.query.includes('comments('))
        return new Response(
          JSON.stringify({
            data: { comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } },
          }),
          { status: 200 },
        );
      if (body.query.includes('issues(')) {
        capturedUpdatedAfter ??= body.variables.updatedAfter;
        const boundaryId = 'boundary-node-shares-the-lower-bound-timestamp';
        return new Response(
          JSON.stringify({
            data: {
              issues: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  { id: preCompletionId, updatedAt: preCompletionUpdatedAt },
                  { id: boundaryId, updatedAt: capturedUpdatedAfter }, // exactly AT the lower bound
                ],
              },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error('Unexpected query: ' + body.query);
    };

    const result = await reconcileLinearWorkspace(f.db, f.env, { fetcher });
    expect(result.issues.complete).toBe(true);
    // Bootstrapped from created_at (the conservative earlier bound), not completed_at.
    expect(capturedUpdatedAfter).toBe(importCreatedAt);

    const enqueued = await f.db.transaction((tx) =>
      tx.all(
        "SELECT delivery_id FROM linear_webhook_inbox WHERE workspace_id=? AND resource_type='Issue' AND delivery_id LIKE 'reconcile:%'",
        [f.init.workspace_id],
      ),
    );
    const ids = enqueued.map((r) => r.delivery_id);
    expect(ids.some((d) => d.includes(preCompletionId))).toBe(true); // between created_at and completed_at
    expect(ids.some((d) => d.includes('boundary-node-shares'))).toBe(true); // exactly at the lower bound: gte, not gt
  } finally {
    await f.close();
  }
});

// finding 6: an unauthenticated/malformed webhook must never pay for a db.transaction
// (connection checkout + BEGIN) at all -- verification happens before one is even opened.
test('R3 finding 6: an invalid signature never opens a db.transaction (verified before any connection checkout)', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const payload = linearWebhookPayload({
      type: 'Issue',
      action: 'update',
      dataId: source.ids.issue,
      organizationId: source.ids.org,
    });
    const raw = JSON.stringify(payload);
    let calls = 0;
    const original = f.db.transaction.bind(f.db);
    f.db.transaction = (...args) => {
      calls++;
      return original(...args);
    };
    const result = await f.request('POST', '/api/webhooks/linear', raw, {
      raw: true,
      anonymous: true,
      headers: { 'linear-signature': 'a'.repeat(64), 'linear-delivery': crypto.randomUUID() },
    });
    f.db.transaction = original;
    expect(result.status).toBe(401);
    expect(result.data.error.code).toBe('BAD_SIGNATURE');
    expect(calls).toBe(0);
  } finally {
    await f.close();
  }
});

// finding 7: comments.issue_id is NOT NULL. A comment with no issue reference at all must
// block as MISSING_REFERENCE on the FIRST attempt, never reach a raw INSERT/UPDATE, and
// never get retried 8 times for something that can never succeed.
test('R3 finding 7: a comment with no issueId at all blocks as MISSING_REFERENCE immediately, never retried', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const orphanCommentId = crypto.randomUUID();
    const payload = linearWebhookPayload({
      type: 'Comment',
      action: 'create',
      dataId: orphanCommentId,
      organizationId: source.ids.org,
    });
    const deliveryId = crypto.randomUUID();
    await postWebhook(f, payload, 'linear-webhook-secret', { deliveryId });
    const orphanComment = {
      id: orphanCommentId,
      body: 'no issue reference at all',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        commentsById: { [orphanCommentId]: orphanComment },
      }),
    });
    expect(result).toEqual({ processed: 0, blocked: 1, failed: 0 });
    const row = await inboxRow(f, deliveryId);
    expect(row.status).toBe('blocked');
    expect(row.last_error).toBe('MISSING_REFERENCE');
    expect(row.attempts).toBe(1); // blocked on the first attempt, never retried
  } finally {
    await f.close();
  }
});

// finding 8: a confirmed no-op (isUnchanged) delivery must never pay for loadResolvers'
// full linear_source_map scan -- only the targeted single-row lookup for this one entity.
test('R3 finding 8: a confirmed no-op delivery never touches linear_source_map beyond its own targeted row lookup', async () => {
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
    await postWebhook(f, payload, 'linear-webhook-secret');
    const firstResult = await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        issuesById: { [source.ids.issue]: remoteRecord },
      }),
    });
    expect(firstResult).toEqual({ processed: 1, blocked: 0, failed: 0 });

    const secondDeliveryId = crypto.randomUUID();
    await postWebhook(f, payload, 'linear-webhook-secret', { deliveryId: secondDeliveryId });
    let fullMapScans = 0;
    const original = f.db.transaction.bind(f.db);
    f.db.transaction = (fn, options) =>
      original((tx) => {
        const wrapped = {
          ...tx,
          all: async (sql, args) => {
            // loadResolvers' full-table scan is the ONLY `.all()` query against
            // linear_source_map anywhere in worker.mjs; the targeted per-entity lookup
            // always uses `.one()`.
            if (sql.includes('FROM linear_source_map')) fullMapScans++;
            return tx.all(sql, args);
          },
        };
        return fn(wrapped);
      }, options);
    const secondResult = await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        issuesById: { [source.ids.issue]: remoteRecord },
      }),
    });
    f.db.transaction = original;
    expect(secondResult).toEqual({ processed: 1, blocked: 0, failed: 0 });
    const row = await inboxRow(f, secondDeliveryId);
    expect(row.status).toBe('done');
    expect(fullMapScans).toBe(0); // loadResolvers never ran for this confirmed no-op
  } finally {
    await f.close();
  }
});

// finding 9: issues and comments must each get their OWN fixed sub-budget, anchored to the
// pass start -- otherwise a slow issues phase starves comments to zero pages every single
// invocation, not just occasionally.
test('R3 finding 9: a slow issues phase does not starve comments of its own budget share', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    let issuesCalls = 0,
      commentsCalls = 0;
    const fetcher = async (url, options) => {
      const body = JSON.parse(options.body);
      if (body.query.includes('organization {'))
        return new Response(JSON.stringify({ data: { organization: { id: source.ids.org } } }), {
          status: 200,
        });
      if (body.query.includes('issues(')) {
        issuesCalls++;
        await new Promise((r) => setTimeout(r, 200)); // slow: eats its OWN sub-budget
        return new Response(
          JSON.stringify({
            data: {
              issues: { pageInfo: { hasNextPage: true, endCursor: 'more' }, nodes: [] },
            },
          }),
          { status: 200 },
        );
      }
      if (body.query.includes('comments(')) {
        commentsCalls++;
        return new Response(
          JSON.stringify({
            data: { comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } },
          }),
          { status: 200 },
        );
      }
      throw new Error('Unexpected query: ' + body.query);
    };
    const result = await reconcileLinearWorkspace(f.db, f.env, { fetcher, budgetMs: 300 });
    expect(issuesCalls).toBeGreaterThanOrEqual(1);
    expect(result.issues.complete).toBe(false); // ran out of its OWN ~150ms sub-budget
    expect(commentsCalls).toBeGreaterThan(0); // comments still got its turn, not starved to zero
  } finally {
    await f.close();
  }
});

// finding 10: an unbounded pending backlog with only a fixed drain per invocation and no
// cron grows forever -- reconcile must stop enqueueing further pages once the backlog
// crosses a sane watermark, and the worker must drain by time budget, not a hardcoded 10.
test('R3 finding 10: reconcile stops enqueueing once the pending backlog crosses the watermark', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    await f.db.transaction(async (tx) => {
      for (let i = 0; i < 500; i++)
        await tx.exec(
          "INSERT INTO linear_webhook_inbox(id,workspace_id,organization_id,delivery_id,resource_type,action,payload,payload_hash,webhook_timestamp,status,attempts,next_attempt_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,'pending',0,?,?)",
          [
            crypto.randomUUID(),
            f.init.workspace_id,
            source.ids.org,
            'seed:' + i,
            'Issue',
            'update',
            '{}',
            'seed-hash-' + i,
            String(Date.now()),
            new Date().toISOString(),
            new Date().toISOString(),
          ],
        );
    });
    const nodeId = crypto.randomUUID();
    const fetcher = async (url, options) => {
      const body = JSON.parse(options.body);
      if (body.query.includes('organization {'))
        return new Response(JSON.stringify({ data: { organization: { id: source.ids.org } } }), {
          status: 200,
        });
      if (body.query.includes('issues('))
        return new Response(
          JSON.stringify({
            data: {
              issues: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [{ id: nodeId, updatedAt: new Date().toISOString() }],
              },
            },
          }),
          { status: 200 },
        );
      if (body.query.includes('comments('))
        return new Response(
          JSON.stringify({
            data: { comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } },
          }),
          { status: 200 },
        );
      throw new Error('Unexpected query: ' + body.query);
    };
    const result = await reconcileLinearWorkspace(f.db, f.env, { fetcher });
    expect(result.issues.error).toBe('BACKPRESSURE');
    expect(result.issues.enqueued).toBe(0);
    const enqueued = await f.db.transaction((tx) =>
      tx.one(
        "SELECT COUNT(*) AS n FROM linear_webhook_inbox WHERE workspace_id=? AND delivery_id LIKE 'reconcile:%'",
        [f.init.workspace_id],
      ),
    );
    expect(Number(enqueued.n)).toBe(0); // never enqueued while over the watermark
  } finally {
    await f.close();
  }
});
test('R3 finding 10: the worker drains by its time budget, not a hardcoded count', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    for (let i = 0; i < 5; i++)
      await postWebhook(
        f,
        linearWebhookPayload({
          type: 'Issue',
          action: 'update',
          dataId: source.ids.issue,
          organizationId: source.ids.org,
        }),
        'linear-webhook-secret',
        { deliveryId: crypto.randomUUID() },
      );
    const realFetcher = fakeLinearTransport({
      organizationId: source.ids.org,
      issuesById: {
        [source.ids.issue]: { ...source.data.issues[1], updatedAt: new Date().toISOString() },
      },
    });
    const fetcher = async (url, options) => {
      await new Promise((r) => setTimeout(r, 60)); // slow enough to exhaust the deadline fast
      return realFetcher(url, options);
    };
    const result = await runLinearSyncWorker(f.db, f.env, {
      limit: 500,
      deadlineMs: Date.now() + 90,
      fetcher,
    });
    // Bounded by TIME, not by the 5 available pending rows or a hardcoded limit.
    expect(result.processed + result.blocked + result.failed).toBeLessThan(5);
  } finally {
    await f.close();
  }
});

// A.1: round 3's finding-8 fix only skipped loadResolvers for a confirmed NO-OP delivery.
// A genuinely CHANGED (non-no-op) delivery still paid the full unfiltered
// linear_source_map scan on every single call. This proves the memoization fix: two
// changed deliveries processed within ONE runLinearSyncWorker call must trigger the full
// scan only ONCE, not twice.
test('A.1: loadResolvers is memoized once per runLinearSyncWorker call, not reloaded per changed delivery', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    // Two independent deliveries for the SAME issue, each a genuine (non-no-op) change.
    const remoteRecord1 = {
      ...source.data.issues[1],
      priority: 3,
      updatedAt: new Date().toISOString(),
    };
    await postWebhook(
      f,
      linearWebhookPayload({
        type: 'Issue',
        action: 'update',
        dataId: source.ids.issue,
        organizationId: source.ids.org,
      }),
      'linear-webhook-secret',
      { deliveryId: crypto.randomUUID() },
    );
    const remoteRecord2 = {
      ...source.data.issues[1],
      priority: 4,
      updatedAt: new Date(Date.now() + 1000).toISOString(),
    };
    await postWebhook(
      f,
      linearWebhookPayload({
        type: 'Issue',
        action: 'update',
        dataId: source.ids.issue,
        organizationId: source.ids.org,
      }),
      'linear-webhook-secret',
      { deliveryId: crypto.randomUUID() },
    );

    let fullMapScans = 0;
    const original = f.db.transaction.bind(f.db);
    f.db.transaction = (fn, options) =>
      original((tx) => {
        const wrapped = {
          ...tx,
          all: async (sql, args) => {
            if (sql.includes('FROM linear_source_map')) fullMapScans++;
            return tx.all(sql, args);
          },
        };
        return fn(wrapped);
      }, options);
    let call = 0;
    const fetcher = async (url, options) => {
      const body = JSON.parse(options.body);
      if (body.query.includes('organization {'))
        return new Response(JSON.stringify({ data: { organization: { id: source.ids.org } } }), {
          status: 200,
        });
      if (body.query.includes('issue(id')) {
        call++;
        const record = call === 1 ? remoteRecord1 : remoteRecord2;
        return new Response(JSON.stringify({ data: { issue: record } }), { status: 200 });
      }
      throw new Error('Unexpected query: ' + body.query);
    };
    const result = await runLinearSyncWorker(f.db, f.env, { fetcher, limit: 10 });
    f.db.transaction = original;
    expect(result).toEqual({ processed: 2, blocked: 0, failed: 0 });
    // Two genuinely changed deliveries, ONE full-table scan -- memoized across the run,
    // not reloaded per delivery.
    expect(fullMapScans).toBe(1);
  } finally {
    await f.close();
  }
});

// A.2: a source issue whose payload is missing a mandatory field (per
// vendor/linear/schema.graphql: title/team/state/priority/createdAt are all non-null) must
// be REJECTED (blocked, MALFORMED_SOURCE_PAYLOAD), never silently defaulted/truncated into
// a fake row that misrepresents what Linear actually holds.
test('A.2: a malformed issue payload (missing title) is rejected, never silently defaulted to an empty title', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const issueKey = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const before = await f.request('GET', '/api/v1/issues/' + issueKey);
    const malformedRecord = { ...source.data.issues[1], title: undefined };
    delete malformedRecord.title;
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
        issuesById: { [source.ids.issue]: malformedRecord },
      }),
    });
    expect(result).toEqual({ processed: 0, blocked: 1, failed: 0 });
    const row = await inboxRow(f, deliveryId);
    expect(row.status).toBe('blocked');
    expect(row.last_error).toBe('MALFORMED_SOURCE_PAYLOAD');
    const after = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(after.data).toEqual(before.data); // completely untouched
  } finally {
    await f.close();
  }
});
test('A.2: a malformed issue payload (missing team) is rejected, never a raw NOT NULL violation retried 8 times', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const malformedRecord = { ...source.data.issues[1] };
    delete malformedRecord.team;
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
        issuesById: { [source.ids.issue]: malformedRecord },
      }),
    });
    expect(result).toEqual({ processed: 0, blocked: 1, failed: 0 });
    const row = await inboxRow(f, deliveryId);
    expect(row.status).toBe('blocked');
    expect(row.last_error).toBe('MALFORMED_SOURCE_PAYLOAD');
    expect(row.attempts).toBe(1); // blocked immediately, never retried
  } finally {
    await f.close();
  }
});
test('A.2: a malformed issue payload (missing state) is rejected as MALFORMED_SOURCE_PAYLOAD', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const malformedRecord = { ...source.data.issues[1] };
    delete malformedRecord.state;
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
        issuesById: { [source.ids.issue]: malformedRecord },
      }),
    });
    expect(result).toEqual({ processed: 0, blocked: 1, failed: 0 });
    const row = await inboxRow(f, deliveryId);
    expect(row.last_error).toBe('MALFORMED_SOURCE_PAYLOAD');
  } finally {
    await f.close();
  }
});
test('A.2: a malformed issue payload (invalid updatedAt) is rejected as MALFORMED_SOURCE_PAYLOAD', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const malformedRecord = { ...source.data.issues[1], updatedAt: 'not-a-real-date' };
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
        issuesById: { [source.ids.issue]: malformedRecord },
      }),
    });
    expect(result).toEqual({ processed: 0, blocked: 1, failed: 0 });
    const row = await inboxRow(f, deliveryId);
    expect(row.last_error).toBe('MALFORMED_SOURCE_PAYLOAD');
  } finally {
    await f.close();
  }
});
test('A.2: a malformed comment payload (missing body) is rejected as MALFORMED_SOURCE_PAYLOAD', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const malformedComment = {
      id: crypto.randomUUID(),
      issue: { id: source.ids.issue },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }; // no `body` at all
    const payload = linearWebhookPayload({
      type: 'Comment',
      action: 'create',
      dataId: malformedComment.id,
      organizationId: source.ids.org,
    });
    const deliveryId = crypto.randomUUID();
    await postWebhook(f, payload, 'linear-webhook-secret', { deliveryId });
    const result = await runLinearSyncWorker(f.db, f.env, {
      fetcher: fakeLinearTransport({
        organizationId: source.ids.org,
        commentsById: { [malformedComment.id]: malformedComment },
      }),
    });
    expect(result).toEqual({ processed: 0, blocked: 1, failed: 0 });
    const row = await inboxRow(f, deliveryId);
    expect(row.last_error).toBe('MALFORMED_SOURCE_PAYLOAD');
  } finally {
    await f.close();
  }
});

// A.2: silently ignoring a team change would leave the row's team permanently desynced
// from Linear; block it explicitly instead so the operator sees why nothing applied.
test('A.2: a remote team reassignment is explicitly blocked, never silently ignored', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const issueKey = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const before = await f.request('GET', '/api/v1/issues/' + issueKey);
    const otherTeamSourceId = crypto.randomUUID();
    const otherTeamNativeId = crypto.randomUUID(); // deliberately DIFFERENT from before.data.team_id
    // A source_map row for a second, DIFFERENT team, so the remote's new team resolves
    // cleanly to something other than the current team (this must block on the
    // REASSIGNMENT itself, not on an unrelated MISSING_REFERENCE). assertNoTeamReassignment
    // fires before any FK validation, so otherTeamNativeId need not be a real `teams` row.
    await f.db.transaction((tx) =>
      tx.exec(
        'INSERT INTO linear_source_map(workspace_id,source_workspace_id,collection,source_id,target_id,payload_hash,import_id) VALUES(?,?,?,?,?,?,(SELECT import_id FROM linear_source_map WHERE workspace_id=? AND collection=? AND source_id=?))',
        [
          f.init.workspace_id,
          source.ids.org,
          'teams',
          otherTeamSourceId,
          otherTeamNativeId,
          'seed-hash',
          f.init.workspace_id,
          'teams',
          source.ids.team,
        ],
      ),
    );
    const remoteRecord = {
      ...source.data.issues[1],
      team: { id: otherTeamSourceId },
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
    expect(row.last_error).toBe('TEAM_REASSIGNMENT_UNSUPPORTED');
    const after = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(after.data).toEqual(before.data); // completely untouched
  } finally {
    await f.close();
  }
});

// P1 title bound: the sync path was the only one with NO cap on title length at all --
// packages/imports/linear-projection.mjs's text() THROWS over 300 chars on import, and
// packages/contracts/schemas.mjs caps the REST API at 300. Truncating silently (the old
// `.slice(0,300)` behavior) is exactly the "fake row" pattern this module rejects
// elsewhere; an oversized title must be rejected, never silently accepted unbounded.
test('P1: an oversized title (>300 chars) is rejected as malformed, never truncated or silently accepted', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const issueKey = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const before = await f.request('GET', '/api/v1/issues/' + issueKey);
    const remoteRecord = {
      ...source.data.issues[1],
      title: 'x'.repeat(301),
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
    expect(row.last_error).toBe('MALFORMED_SOURCE_PAYLOAD');
    const after = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(after.data).toEqual(before.data); // never truncated, never applied
  } finally {
    await f.close();
  }
});

// P1: guard against a mock/real API answering the wrong record for the requested id --
// a wrong-record response would otherwise silently apply as if it were the entity asked
// for.
test('P1: a hydrated record whose id does not match the requested sourceId is rejected, never silently applied', async () => {
  const { f, source } = await syncFixture(fixture);
  try {
    const issueKey = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);
    const before = await f.request('GET', '/api/v1/issues/' + issueKey);
    const wrongRecord = {
      ...source.data.issues[1],
      id: crypto.randomUUID(), // does NOT match source.ids.issue
      title: 'This belongs to a different issue entirely',
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
      fetcher: async (url, options) => {
        const body = JSON.parse(options.body);
        if (body.query.includes('organization {'))
          return new Response(JSON.stringify({ data: { organization: { id: source.ids.org } } }), {
            status: 200,
          });
        if (body.query.includes('issue(id'))
          return new Response(JSON.stringify({ data: { issue: wrongRecord } }), { status: 200 });
        throw new Error('Unexpected query: ' + body.query);
      },
    });
    expect(result).toEqual({ processed: 0, blocked: 1, failed: 0 });
    const row = await inboxRow(f, deliveryId);
    expect(row.last_error).toBe('SOURCE_ID_MISMATCH');
    const after = await f.request('GET', '/api/v1/issues/' + issueKey);
    expect(after.data).toEqual(before.data); // never applied
  } finally {
    await f.close();
  }
});
