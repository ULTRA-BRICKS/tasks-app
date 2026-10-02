// Durable, signed webhook inbox for POST /api/webhooks/linear. This module only verifies,
// classifies and persists a delivery — it never calls the network and never touches issue/
// comment rows. Applying a delivery happens later, in worker.mjs, over the durable row this
// function writes.
//
// Header names (`linear-signature`, `linear-delivery`) follow Linear's public webhook docs
// (https://linear.app/developers/webhooks) but were NOT live-verified against a real
// delivery in this environment — see docs/LINEAR-SYNC.md.
import { id, now, hmac, constantEqual } from '../../core/crypto.mjs';
import { assert } from '../../core/errors.mjs';
import { assertModule } from '../../core/modules.mjs';
import { canonical, digest, uuid } from '../../../imports/linear-source.mjs';

const MAX_PAYLOAD_BYTES = 1024 * 1024;
const FRESHNESS_WINDOW_MS = 60000;
const SUPPORTED = new Set([
  'Issue:create',
  'Issue:update',
  'Issue:remove',
  'Comment:create',
  'Comment:update',
  'Comment:remove',
]);

async function syncConfig(tx, env) {
  const workspace = env.LINEAR_SYNC_WORKSPACE_ID;
  assert(workspace, 503, 'LINEAR_SYNC_NOT_CONFIGURED', 'Linear sync workspace is not configured');
  assert(
    env.LINEAR_WEBHOOK_SECRET,
    503,
    'LINEAR_SYNC_NOT_CONFIGURED',
    'Linear webhook secret is not configured',
  );
  await tx.lock(workspace);
  await assertModule(tx, workspace, 'linear-sync');
  const completedImport = await tx.one(
    "SELECT source_workspace_id FROM linear_imports WHERE workspace_id=? AND status='completed' ORDER BY completed_at DESC LIMIT 1",
    [workspace],
  );
  assert(
    completedImport,
    503,
    'LINEAR_SYNC_NOT_CONFIGURED',
    'No completed Linear import exists for this workspace to sync against',
  );
  return { workspace, sourceWorkspaceId: completedImport.source_workspace_id };
}

function verifySignature(raw, signature, secret) {
  assert(
    typeof signature === 'string' && signature.length === 64,
    401,
    'BAD_SIGNATURE',
    'Invalid webhook signature',
  );
  assert(
    constantEqual(signature, hmac(secret, raw)),
    401,
    'BAD_SIGNATURE',
    'Invalid webhook signature',
  );
}

function verifyFreshness(webhookTimestamp, time) {
  assert(
    typeof webhookTimestamp === 'number' && Number.isFinite(webhookTimestamp),
    400,
    'INVALID_PAYLOAD',
    'webhookTimestamp must be a numeric epoch-milliseconds value',
  );
  assert(
    Math.abs(time - webhookTimestamp) <= FRESHNESS_WINDOW_MS,
    401,
    'STALE_REQUEST',
    'Linear webhook delivery is stale',
  );
}

async function recordDelivery(tx, workspace, row) {
  const insert = await tx.exec(
    'INSERT INTO linear_webhook_inbox(id,workspace_id,organization_id,delivery_id,resource_type,action,payload,payload_hash,webhook_timestamp,status,attempts,next_attempt_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?) ON CONFLICT(workspace_id,delivery_id) DO NOTHING',
    [
      id(),
      workspace,
      row.organizationId,
      row.deliveryId,
      row.resourceType,
      row.action,
      canonical(row.payload),
      row.payloadHash,
      String(row.webhookTimestamp),
      row.status,
      now(),
      now(),
    ],
  );
  if (Number(insert.changes) === 1) return { accepted: true, duplicate: false };
  const existing = await tx.one(
    'SELECT payload_hash FROM linear_webhook_inbox WHERE workspace_id=? AND delivery_id=?',
    [workspace, row.deliveryId],
  );
  if (existing?.payload_hash === row.payloadHash) return { accepted: true, duplicate: true };
  await tx.exec(
    'INSERT INTO linear_webhook_inbox_mismatches(id,workspace_id,delivery_id,payload_hash,payload,created_at) VALUES(?,?,?,?,?,?)',
    [id(), workspace, row.deliveryId, row.payloadHash, canonical(row.payload), now()],
  );
  return { accepted: true, duplicate: true, mismatch: true };
}

export async function receiveLinearWebhook(tx, headers, raw, env, { time = Date.now() } = {}) {
  assert(
    Buffer.byteLength(raw) <= MAX_PAYLOAD_BYTES,
    413,
    'BODY_TOO_LARGE',
    'Webhook payload exceeds the size limit',
  );
  const { workspace, sourceWorkspaceId } = await syncConfig(tx, env);
  verifySignature(raw, headers.get('linear-signature'), env.LINEAR_WEBHOOK_SECRET);
  let payload;
  try {
    payload = JSON.parse(raw.toString());
  } catch {
    assert(false, 400, 'INVALID_JSON', 'Invalid webhook payload');
  }
  verifyFreshness(payload.webhookTimestamp, time);
  assert(
    payload.organizationId === sourceWorkspaceId,
    403,
    'ORGANIZATION_NOT_ALLOWED',
    'Webhook organization does not match the imported Linear workspace',
  );
  const deliveryId = headers.get('linear-delivery');
  assert(uuid(deliveryId), 400, 'MISSING_DELIVERY', 'Linear delivery ID required');
  assert(
    typeof payload.type === 'string' && typeof payload.action === 'string',
    400,
    'INVALID_PAYLOAD',
    'Webhook payload requires type and action',
  );
  const supported = SUPPORTED.has(`${payload.type}:${payload.action}`);
  return recordDelivery(tx, workspace, {
    organizationId: payload.organizationId,
    deliveryId,
    resourceType: payload.type,
    action: payload.action,
    payload,
    payloadHash: digest(payload),
    webhookTimestamp: payload.webhookTimestamp,
    status: supported ? 'pending' : 'unsupported',
  });
}
