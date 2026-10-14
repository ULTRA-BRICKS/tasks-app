import { assert, requirePermission } from '../../core/errors.mjs';
import { canonical, digest, uuid } from '../../../imports/linear-source.mjs';
import { now } from '../../core/crypto.mjs';
import {
  readSyncConfig,
  enqueueSyncJob,
  assertJobFence,
  finishSyncJob,
  writeEntityState,
} from './store.mjs';
import { loadNative, sourceMapping } from './context.mjs';
import {
  readSourceEntity,
  verifySourceOrganization,
  requestLinear,
  SOURCE_MODELS,
  SourceError,
} from './client.mjs';
import { createMigrationNotice, mappedNoticeVerifier } from './migration-notice.mjs';
import { markdownEquivalent } from '../linear-import/source-contract.mjs';

export async function planMigrationNotices(tx, actor, env, input = {}) {
  requirePermission(actor, 'admin');
  const config = await readSyncConfig(tx, env);
  assert(config.workspaceId === actor.workspace_id, 403, 'SYNC_WORKSPACE', 'Workspace mismatch');
  const limit = input.limit ?? 25,
    cursor = input.cursor ?? null;
  assert(
    Number.isInteger(limit) && limit >= 1 && limit <= 50 && (!cursor || uuid(cursor)),
    422,
    'INVALID_NOTICE_PAGE',
    'Invalid migration-notice page',
  );
  assert(
    !input.apply || uuid(input.passId),
    422,
    'NOTICE_PASS_REQUIRED',
    'A stable pass UUID is required for applying a resumable backfill',
  );
  const rows = await tx.all(
    "SELECT m.source_id,m.target_id,i.key,i.deleted_at,t.source_id AS source_team_id FROM linear_source_map m JOIN issues i ON i.workspace_id=m.workspace_id AND i.id=m.target_id JOIN linear_source_map t ON t.workspace_id=i.workspace_id AND t.source_workspace_id=m.source_workspace_id AND t.collection='teams' AND t.target_id=i.team_id WHERE m.workspace_id=? AND m.source_workspace_id=? AND m.collection='issues'" +
      (cursor ? ' AND m.source_id>?' : '') +
      ' ORDER BY m.source_id LIMIT ?',
    [actor.workspace_id, config.organizationId, ...(cursor ? [cursor] : []), limit + 1],
  );
  const page = rows.slice(0, limit),
    planned = [],
    skipped = [];
  if (input.apply) {
    await tx.exec(
      "INSERT INTO module_settings(workspace_id,module,enabled,config) VALUES(?,'linear-migration-notices',1,?) ON CONFLICT(workspace_id,module) DO UPDATE SET enabled=1,config=excluded.config",
      [
        actor.workspace_id,
        canonical({ enabled: true, startedBy: actor.id, startedAt: now(), passId: input.passId }),
      ],
    );
  }
  for (const row of page) {
    if (
      row.deleted_at ||
      row.key.startsWith('PENDING-') ||
      (config.teamIds?.length && !config.teamIds.includes(row.source_team_id))
    ) {
      skipped.push({
        sourceId: row.source_id,
        reason: row.deleted_at
          ? 'native-deleted'
          : row.key.startsWith('PENDING-')
            ? 'awaiting-code'
            : 'outside-team-scope',
      });
      continue;
    }
    const item = { sourceId: row.source_id, targetId: row.target_id, code: row.key };
    if (input.apply) {
      const job = await enqueueSyncJob(
        tx,
        actor.workspace_id,
        {
          kind: 'entity',
          collection: 'issues',
          sourceId: row.source_id,
          targetId: row.target_id,
          action: 'migration-notice',
          side: 'source',
        },
        'migration-notice:' + input.passId + ':' + row.source_id,
      );
      item.jobId = job.id;
    }
    planned.push(item);
  }
  return {
    applied: Boolean(input.apply),
    planned,
    skipped,
    nextCursor: rows.length > limit ? page.at(-1).source_id : null,
    complete: rows.length <= limit,
  };
}

export async function applyMigrationNotice(db, env, job, options = {}) {
  options = {
    ...options,
    verifyMigrationNotices: mappedNoticeVerifier(db, job.config, { allowStaleCode: true }),
  };
  assert(
    job.data.action === 'migration-notice' && job.data.collection === 'issues',
    422,
    'INVALID_NOTICE_JOB',
    'Unexpected migration-notice operation',
  );
  await verifySourceOrganization(env, job.config.organizationId, options);
  const prepared = await db.transaction(async (tx) => {
    await assertJobFence(tx, job);
    const mapping = await sourceMapping(tx, job.config, 'issues', job.data.sourceId);
    assert(
      mapping,
      409,
      'SYNC_REFERENCE_PENDING',
      'Only a confirmed source mapping can be marked migrated',
    );
    assert(
      !job.data.targetId || mapping.target_id === job.data.targetId,
      409,
      'SYNC_IDENTITY_CONFLICT',
      'Migration target changed',
    );
    const native = await loadNative(tx, job.config, 'issues', mapping.target_id);
    assert(
      native && !native.deleted_at && !native.key.startsWith('PENDING-'),
      409,
      'NOTICE_TARGET_UNAVAILABLE',
      'Migration target is not ready',
    );
    return { native, fingerprint: digest(native) };
  });
  const source = await readSourceEntity(env, 'issues', job.data.sourceId, options);
  assert(
    source,
    409,
    'NOTICE_SOURCE_UNAVAILABLE',
    'Source task is unavailable; no migration notice written',
  );
  assert(
    source.identifier === prepared.native.key,
    409,
    'NOTICE_CODE_MISMATCH',
    'Source and native task codes differ',
  );
  assert(
    !job.config.teamIds?.length || job.config.teamIds.includes(source.team?.id),
    403,
    'SYNC_SCOPE_UNAVAILABLE',
    'Source task is outside configured teams',
  );
  const identity = {
    appOrigin: env.APP_URL,
    organizationId: job.config.organizationId,
    sourceId: source.id,
    targetId: prepared.native.id,
    code: prepared.native.key,
  };
  const existing = source._migrationNotice;
  if (existing)
    assert(
      existing.organizationId === identity.organizationId &&
        existing.targetId === identity.targetId,
      409,
      'SYNC_IDENTITY_CONFLICT',
      'Existing notice points to a different task',
    );
  let written = false,
    observed = source;
  if (!existing || existing.code !== identity.code) {
    const before = source.description ?? '';
    const checked = await readSourceEntity(env, 'issues', source.id, options);
    if (
      !checked ||
      checked.updatedAt !== source.updatedAt ||
      checked.description !== source.description
    )
      throw new SourceError('SOURCE_CHANGED_BEFORE_WRITE', 2);
    await db.transaction(async (tx) => {
      await assertJobFence(tx, job);
      assert(
        digest(await loadNative(tx, job.config, 'issues', identity.targetId)) ===
          prepared.fingerprint,
        409,
        'VERSION_CONFLICT',
        'Task changed before notice placement',
      );
      await writeEntityState(tx, job.workspace_id, 'migration-notice', source.id, {
        sourceId: source.id,
        targetId: identity.targetId,
        phase: 'writing',
        sourceBefore: { description: before, updatedAt: source.updatedAt, code: source.identifier },
        identity,
        at: now(),
      });
    });
    const description = createMigrationNotice(before, {
      ...identity,
      secret: env.LINEAR_WEBHOOK_SECRET,
    });
    const result = await requestLinear(
      env,
      `mutation MigrationNoticeWrite($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success issue{${SOURCE_MODELS.issues.fields}}}}`,
      { id: source.id, input: { description } },
      options,
    );
    assert(
      result.issueUpdate?.success && result.issueUpdate.issue?.id === source.id,
      502,
      'SOURCE_WRITE_UNCONFIRMED',
      'Migration notice was not confirmed',
    );
    observed = await readSourceEntity(env, 'issues', source.id, options);
    assert(
      observed?._migrationNotice?.targetId === identity.targetId &&
        observed._migrationNotice.code === identity.code &&
        markdownEquivalent(observed.description ?? '', before),
      409,
      'NOTICE_READBACK_MISMATCH',
      'Notice verification did not preserve the source body',
    );
    written = true;
  }
  await db.transaction(async (tx) => {
    await assertJobFence(tx, job);
    const current = await loadNative(tx, job.config, 'issues', identity.targetId);
    assert(
      current?.key === identity.code,
      409,
      'NOTICE_CODE_MISMATCH',
      'Task code changed while placing its notice',
    );
    await writeEntityState(tx, job.workspace_id, 'migration-notice', source.id, {
      sourceId: source.id,
      targetId: identity.targetId,
      phase: 'verified',
      identity,
      sourceBefore: {
        description: source.description ?? '',
        updatedAt: source.updatedAt,
        code: source.identifier,
      },
      sourceBodyHash: digest(observed.description ?? ''),
      sourceUpdatedAt: observed.updatedAt,
      verifiedAt: now(),
    });
    await finishSyncJob(tx, job, { marked: true, code: identity.code, written });
  });
  return { marked: true, code: identity.code, written };
}
