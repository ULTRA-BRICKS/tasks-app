import { enqueueNativeSyncJob } from '../modules/linear-live/store.mjs';
export async function queueNativeLinearChange(tx, actor, collection, targetIdValue, revision) {
  if (actor.syncOrigin === 'linear') return;
  const config = await tx.one(
    "SELECT config FROM module_settings WHERE workspace_id=? AND module='linear' AND enabled=1",
    [actor.workspace_id],
  );
  const settings = config ? JSON.parse(config.config) : null;
  if (!settings?.enabled) return;
  const organization = settings.organizationId;
  const mapped = await tx.all(
    'SELECT source_id FROM linear_source_map WHERE workspace_id=? AND source_workspace_id=? AND collection=? AND target_id=?',
    [actor.workspace_id, organization, collection, targetIdValue],
  );
  const payload = {
    kind: 'entity',
    collection,
    targetId: targetIdValue,
    sourceId: mapped.length === 1 ? mapped[0].source_id : targetIdValue,
    side: 'native',
    revision,
  };
  await enqueueNativeSyncJob(tx, actor.workspace_id, payload);
}
