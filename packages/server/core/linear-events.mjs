import { targetId, canonical } from '../../imports/linear-source.mjs';
import { now } from './crypto.mjs';
export async function queueNativeLinearChange(tx, actor, collection, targetIdValue, revision) {
  if (actor.syncOrigin === 'linear') return;
  const config = await tx.one(
    "SELECT config FROM module_settings WHERE workspace_id=? AND module='linear' AND enabled=1",
    [actor.workspace_id],
  );
  if (!config || !JSON.parse(config.config).enabled) return;
  const organization = JSON.parse(config.config).organizationId;
  const mapped = await tx.one(
    'SELECT source_id FROM linear_source_map WHERE workspace_id=? AND source_workspace_id=? AND collection=? AND target_id=?',
    [actor.workspace_id, organization, collection, targetIdValue],
  );
  const payload = {
    kind: 'entity',
    collection,
    targetId: targetIdValue,
    sourceId: mapped?.source_id ?? targetIdValue,
    side: 'native',
  };
  const stamp = now(),
    jobId = targetId(
      actor.workspace_id,
      'linear-managed-v1',
      'job',
      'native:' + collection + ':' + targetIdValue + ':' + revision,
    );
  await tx.exec(
    "INSERT INTO outbox(id,workspace_id,provider,event,payload,status,attempts,next_attempt_at,created_at) VALUES(?,?,'linear','entity',?,'pending',0,?,?) ON CONFLICT(id) DO NOTHING",
    [jobId, actor.workspace_id, canonical(payload), stamp, stamp],
  );
}
