import { assert, requirePermission } from '../../core/errors.mjs';
import { hmac, constantEqual, now } from '../../core/crypto.mjs';
import { canonical, digest, targetId, uuid } from '../../../imports/linear-source.mjs';
const LIMIT = 1000000;
function configuration(env) {
  const config = {
    workspace: env.LINEAR_SYNC_WORKSPACE_ID,
    organization: env.LINEAR_WEBHOOK_ORGANIZATION_ID,
    webhook: env.LINEAR_WEBHOOK_ID,
  };
  assert(
    uuid(config.workspace) &&
      uuid(config.organization) &&
      uuid(config.webhook) &&
      typeof env.LINEAR_WEBHOOK_SECRET === 'string' &&
      env.LINEAR_WEBHOOK_SECRET.length >= 16,
    503,
    'LINEAR_RECEIVER_NOT_CONFIGURED',
    'The signed Linear receiver is not configured',
  );
  return config;
}
export async function verifyCaptureRequest(request, env, time = Date.now()) {
  const config = configuration(env),
    declared = request.headers.get('content-length');
  assert(
    !declared || (/^\d+$/.test(declared) && Number(declared) <= LIMIT),
    413,
    'WEBHOOK_TOO_LARGE',
    'Webhook body exceeds one megabyte',
  );
  const chunks = [];
  let length = 0;
  if (request.body) {
    const reader = request.body.getReader();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > LIMIT) {
          await reader.cancel().catch(() => {});
          assert(false, 413, 'WEBHOOK_TOO_LARGE', 'Webhook body exceeds one megabyte');
        }
        chunks.push(Buffer.from(next.value));
      }
    } finally {
      reader.releaseLock();
    }
  }
  const raw = Buffer.concat(chunks, length),
    signature = request.headers.get('linear-signature');
  assert(
    typeof signature === 'string' &&
      /^[a-f0-9]{64}$/i.test(signature) &&
      constantEqual(signature.toLowerCase(), hmac(env.LINEAR_WEBHOOK_SECRET, raw)),
    401,
    'BAD_SIGNATURE',
    'Invalid Linear webhook signature',
  );
  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    assert(false, 400, 'INVALID_WEBHOOK', 'Expected a JSON data-change event');
  }
  assert(
    event && typeof event === 'object' && !Array.isArray(event),
    400,
    'INVALID_WEBHOOK',
    'Expected a data-change event',
  );
  assert(
    Number.isSafeInteger(event.webhookTimestamp) &&
      Math.abs(time - event.webhookTimestamp) <= 60000,
    401,
    'STALE_WEBHOOK',
    'Webhook send timestamp is not current',
  );
  const deliveryId = request.headers.get('linear-delivery');
  assert(
    uuid(deliveryId) && uuid(event.data?.id) && uuid(event.organizationId),
    400,
    'INVALID_WEBHOOK',
    'Invalid delivery or entity identity',
  );
  assert(
    event.organizationId === config.organization && event.webhookId === config.webhook,
    403,
    'WRONG_WEBHOOK_SCOPE',
    'Unexpected Linear organization or webhook',
  );
  assert(
    typeof event.type === 'string' &&
      /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(event.type) &&
      ['create', 'update', 'remove'].includes(event.action),
    400,
    'INVALID_WEBHOOK',
    'Invalid data-change event shape',
  );
  assert(
    typeof event.createdAt === 'string' &&
      /^\d{4}-\d{2}-\d{2}T/.test(event.createdAt) &&
      Number.isFinite(Date.parse(event.createdAt)),
    400,
    'INVALID_WEBHOOK',
    'Invalid source occurrence timestamp',
  );
  const headerType = request.headers.get('linear-event');
  assert(
    !headerType || headerType === event.type,
    400,
    'EVENT_TYPE_MISMATCH',
    'Header and signed body name different events',
  );
  // A retried send may have a new transport timestamp. Every source/actor/data field remains part of identity.
  const { webhookTimestamp: _sentAt, ...sourceEvent } = event;
  return { config, event, deliveryId, hash: digest(sourceEvent) };
}
export async function captureLinearEvent(tx, verified) {
  const { config, event, deliveryId, hash } = verified;
  const imported = await tx.one(
    "SELECT id FROM linear_imports WHERE workspace_id=? AND source_workspace_id=? AND status='completed' LIMIT 1",
    [config.workspace, config.organization],
  );
  assert(
    imported,
    403,
    'WRONG_WEBHOOK_SCOPE',
    'This source organization has not been imported into the target workspace',
  );
  await tx.lock(config.workspace + ':linear-delivery:' + deliveryId);
  const id = targetId(config.workspace, config.organization, 'delivery', deliveryId);
  const previous = await tx.one(
    "SELECT id,payload FROM webhook_deliveries WHERE workspace_id=? AND provider='linear' AND delivery_id=?",
    [config.workspace, deliveryId],
  );
  if (previous) {
    const old = JSON.parse(previous.payload);
    assert(
      old.captureSchema === 1 && old.hash === hash,
      409,
      'WEBHOOK_REPLAY_MISMATCH',
      'Delivery ID refers to different signed source content',
    );
    return {
      received: true,
      receiptId: previous.id,
      duplicate: true,
      mode: 'capture-only',
      applied: false,
    };
  }
  const stamp = now();
  await tx.exec(
    "INSERT INTO webhook_deliveries(id,workspace_id,provider,delivery_id,payload,event,status,attempts,next_attempt_at,created_at) VALUES(?,?,'linear',?,?,?,'captured',0,?,?)",
    [
      id,
      config.workspace,
      deliveryId,
      canonical({
        captureSchema: 1,
        hash,
        event,
        receivedAt: stamp,
        applicationState: 'pending-worker-release',
      }),
      event.type,
      stamp,
      stamp,
    ],
  );
  return { received: true, receiptId: id, duplicate: false, mode: 'capture-only', applied: false };
}
export async function captureStatus(tx, actor, env) {
  requirePermission(actor, 'admin');
  const config = configuration(env);
  assert(
    actor.workspace_id === config.workspace,
    403,
    'WRONG_WEBHOOK_SCOPE',
    'This workspace is not the configured receiver',
  );
  const count = await tx.one(
    "SELECT COUNT(*) AS total,MAX(created_at) AS latest FROM webhook_deliveries WHERE workspace_id=? AND provider='linear' AND status='captured'",
    [actor.workspace_id],
  );
  const rows = await tx.all(
    "SELECT id,delivery_id,event,status,created_at FROM webhook_deliveries WHERE workspace_id=? AND provider='linear' AND status='captured' ORDER BY created_at DESC,id DESC LIMIT 20",
    [actor.workspace_id],
  );
  return {
    mode: 'capture-only',
    receiverConfigured: true,
    webhookId: config.webhook,
    organizationId: config.organization,
    received: Number(count.total),
    lastReceivedAt: count.latest,
    recent: rows,
    automaticApplicationEnabled: false,
    applicationState: 'pending-worker-release',
    sourceApiCredentialRequiredForCapture: false,
  };
}
