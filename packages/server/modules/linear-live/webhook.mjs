import { assert } from '../../core/errors.mjs';
import { hmac, constantEqual, now } from '../../core/crypto.mjs';
import { canonical, digest, targetId, uuid } from '../../../imports/linear-source.mjs';
import { readSyncConfig, enqueueSyncJob } from './store.mjs';
export const RESOURCE_COLLECTIONS = Object.freeze({
  Issue: 'issues',
  Comment: 'comments',
  Project: 'projects',
  Document: 'documents',
  Initiative: 'initiatives',
  IssueLabel: 'issueLabels',
  Cycle: 'cycles',
  User: 'users',
  Attachment: 'attachments',
  ProjectUpdate: 'projectUpdates',
  InitiativeUpdate: 'initiativeUpdates',
});
export function verifySourceWebhook(headers, raw, env, time = Date.now()) {
  assert(
    env.LINEAR_WEBHOOK_SECRET && env.LINEAR_SYNC_WORKSPACE_ID,
    503,
    'SYNC_NOT_CONFIGURED',
    'Linear receiver is not configured',
  );
  assert(raw.length <= 1000000, 413, 'WEBHOOK_TOO_LARGE', 'Webhook payload exceeds one megabyte');
  const signature = headers.get('linear-signature');
  assert(
    typeof signature === 'string' &&
      /^[a-f0-9]{64}$/i.test(signature) &&
      constantEqual(signature.toLowerCase(), hmac(env.LINEAR_WEBHOOK_SECRET, raw)),
    401,
    'BAD_SIGNATURE',
    'Webhook signature is invalid',
  );
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    assert(false, 400, 'INVALID_WEBHOOK', 'Expected JSON webhook data');
  }
  assert(
    payload && typeof payload === 'object' && !Array.isArray(payload),
    400,
    'INVALID_WEBHOOK',
    'Invalid payload',
  );
  assert(
    Number.isFinite(payload.webhookTimestamp) && Math.abs(time - payload.webhookTimestamp) <= 60000,
    401,
    'STALE_WEBHOOK',
    'Webhook delivery timestamp is not fresh',
  );
  const deliveryId = headers.get('linear-delivery');
  assert(
    uuid(deliveryId) && uuid(payload.organizationId) && uuid(payload.data?.id),
    400,
    'INVALID_WEBHOOK',
    'Webhook IDs must be UUIDs',
  );
  assert(
    ['create', 'update', 'remove'].includes(payload.action) && typeof payload.type === 'string',
    400,
    'INVALID_WEBHOOK',
    'Unsupported action shape',
  );
  assert(
    typeof payload.createdAt === 'string' &&
      /^\d{4}-\d{2}-\d{2}T/.test(payload.createdAt) &&
      Number.isFinite(Date.parse(payload.createdAt)),
    400,
    'INVALID_WEBHOOK',
    'Occurrence time is missing',
  );
  assert(
    !env.LINEAR_WEBHOOK_ID || payload.webhookId === env.LINEAR_WEBHOOK_ID,
    403,
    'WRONG_WEBHOOK',
    'Webhook configuration does not match',
  );
  return { deliveryId, payload };
}
export async function receiveSourceWebhook(tx, event, env) {
  const config = await readSyncConfig(tx, env);
  await tx.lock(config.workspaceId);
  assert(
    event.payload.organizationId === config.organizationId,
    403,
    'WRONG_ORGANIZATION',
    'Webhook belongs to another organization',
  );
  const { webhookTimestamp: _deliveryTime, ...businessEvent } = event.payload;
  const hash = digest(businessEvent),
    existing = await tx.one(
      "SELECT payload FROM webhook_deliveries WHERE workspace_id=? AND provider='linear' AND delivery_id=?",
      [config.workspaceId, event.deliveryId],
    );
  if (existing) {
    const prior = JSON.parse(existing.payload);
    return prior.hash === hash ? { jobId: prior.jobId, duplicate: true } : { mismatch: true };
  }
  const collection = RESOURCE_COLLECTIONS[event.payload.type],
    sourceId = event.payload.data.id;
  const job = collection
    ? await enqueueSyncJob(
        tx,
        config.workspaceId,
        {
          kind: 'entity',
          collection,
          sourceId,
          side: 'source',
          action: event.payload.action,
          occurredAt: new Date(event.payload.createdAt).toISOString(),
          deliveryId: event.deliveryId,
          actor: event.payload.actor ?? null,
          sourceEvent: event.payload,
        },
        'webhook:' + event.deliveryId,
      )
    : null;
  await tx.exec(
    "INSERT INTO webhook_deliveries(id,workspace_id,provider,delivery_id,payload,event,status,attempts,next_attempt_at,created_at) VALUES(?,?,'linear',?,?,?,?,0,?,?)",
    [
      targetId(config.workspaceId, config.organizationId, 'delivery', event.deliveryId),
      config.workspaceId,
      event.deliveryId,
      canonical({ hash, jobId: job?.id ?? null, event: event.payload }),
      event.payload.type,
      job ? 'queued' : 'unsupported',
      now(),
      now(),
    ],
  );
  return { jobId: job?.id ?? null, unsupported: !collection };
}

export async function readWebhookBytes(request, limit = 1000000) {
  const declared = request.headers.get('content-length');
  assert(
    !declared || (/^\d+$/.test(declared) && Number(declared) <= limit),
    413,
    'WEBHOOK_TOO_LARGE',
    'Webhook exceeds one megabyte',
  );
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader(),
    chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        assert(false, 413, 'WEBHOOK_TOO_LARGE', 'Webhook exceeds one megabyte');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}
