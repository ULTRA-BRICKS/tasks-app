import { digest } from '../../../imports/linear-source.mjs';

export async function scheduleMigrationNotice(tx, job, result, enqueue, readState) {
  if (
    job.data.kind !== 'entity' ||
    job.data.collection !== 'issues' ||
    job.data.action === 'migration-notice' ||
    job.data.action === 'remove' ||
    result?.ignored
  )
    return;
  const setting = await tx.one(
    "SELECT enabled FROM module_settings WHERE workspace_id=? AND module='linear-migration-notices'",
    [job.workspace_id],
  );
  if (!setting?.enabled) return;
  const mapping = await tx.one(
    "SELECT m.source_id,m.target_id,i.key,i.deleted_at FROM linear_source_map m JOIN issues i ON i.workspace_id=m.workspace_id AND i.id=m.target_id WHERE m.workspace_id=? AND m.source_workspace_id=? AND m.collection='issues' AND m.source_id=?",
    [job.workspace_id, job.config.organizationId, job.data.sourceId],
  );
  if (!mapping || mapping.deleted_at || mapping.key.startsWith('PENDING-')) return;
  const state = await readState(tx, job.workspace_id, 'issues', mapping.source_id);
  // A confirmed identity/code move needs its signed link refreshed even when an
  // unrelated business field conflicts. The refresh only wraps the current
  // source body and cannot resolve or overwrite that business-field conflict.
  const movedNotice =
    state?.migrationNotice?.sourceId === mapping.source_id &&
    state.migrationNotice.targetId === mapping.target_id &&
    state.migrationNotice.organizationId === job.config.organizationId &&
    state.migrationNotice.code !== mapping.key &&
    state.sourceCode === mapping.key &&
    state.nativeCode === mapping.key;
  if (result?.conflicts?.length && !movedNotice) return;
  if (
    state?.collection === 'issues' &&
    state.migrationNotice?.sourceId === mapping.source_id &&
    state.migrationNotice?.targetId === mapping.target_id &&
    state.migrationNotice?.code === mapping.key
  )
    return;
  const fingerprint = digest([mapping.source_id, mapping.key, state?.sourceUpdatedAt ?? null]);
  await enqueue(
    tx,
    job.workspace_id,
    {
      kind: 'entity',
      collection: 'issues',
      sourceId: mapping.source_id,
      targetId: mapping.target_id,
      side: 'source',
      action: 'migration-notice',
    },
    'migration-notice:' + fingerprint,
  );
}
