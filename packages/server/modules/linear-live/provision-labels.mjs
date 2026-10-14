import { assert } from '../../core/errors.mjs';
import { id } from '../../core/crypto.mjs';
import { digest, targetId, uuid } from '../../../imports/linear-source.mjs';
import { loadNative, referenceResolver, registerSource } from './context.mjs';
import { assertJobFence, readEntityState, writeEntityState } from './store.mjs';
import { requestLinear, SourceError, SOURCE_MODELS } from './client.mjs';

// Provision only a missing dependency. Never substitute a foreign-team label or drop a label
// from the issue. The durable intent's UUID is shared by retries and competing issue jobs.
export async function ensureIssueLabels(db, env, job, nativeId, options = {}) {
  const snapshot = await db.transaction(async (tx) => {
    await assertJobFence(tx, job);
    const native = await loadNative(tx, job.config, 'issues', nativeId);
    assert(native && !native.deleted_at, 409, 'SYNC_TARGET_ABSENT', 'Issue is unavailable');
    assert((native.label_ids ?? []).length <= 100, 422, 'SYNC_REFERENCE_BUDGET', 'Too many labels');
    const resolver = await referenceResolver(tx, job.config, 'issues', null, null, native);
    const teamId = options.sourceTeamId ?? resolver.reverse('teams', native.team_id);
    assert(uuid(teamId), 422, 'SOURCE_REFERENCE_INVALID', 'Invalid source team');
    assert(
      !job.config.teamIds?.length || job.config.teamIds.includes(teamId),
      403,
      'SYNC_SCOPE_UNAVAILABLE',
      'Source team is outside synchronization scope',
    );
    const missing = [];
    for (const labelId of native.label_ids ?? []) {
      try {
        resolver.reverse('issueLabels', labelId, { teamId });
      } catch (error) {
        if (!['SYNC_LABEL_TEAM_UNAVAILABLE', 'SYNC_REFERENCE_PENDING'].includes(error.code))
          throw error;
        const label = await loadNative(tx, job.config, 'issueLabels', labelId);
        assert(label, 409, 'SYNC_REFERENCE_PENDING', 'Native label is unavailable');
        missing.push(label);
      }
    }
    return { teamId, missing };
  });
  for (const label of snapshot.missing) {
    const teamId = snapshot.teamId;
    const stateId = targetId(
      job.workspace_id,
      job.config.organizationId,
      'label-provision',
      label.id + ':' + teamId,
    );
    const intent = await db.transaction(async (tx) => {
      await assertJobFence(tx, job);
      const existing = await readEntityState(tx, job.workspace_id, 'label-provision', stateId);
      assert(
        !existing ||
          (existing.targetId === label.id &&
            existing.teamId === teamId &&
            existing.organizationId === job.config.organizationId),
        409,
        'SYNC_IDENTITY_CONFLICT',
        'Label provision identity changed',
      );
      if (existing) {
        assert(
          existing.input.name === label.name,
          409,
          'SYNC_LABEL_CHANGED',
          'Label name changed during provisioning',
        );
        return existing;
      }
      const value = {
        collection: 'label-provision',
        sourceId: stateId,
        targetId: label.id,
        teamId,
        organizationId: job.config.organizationId,
        input: { id: id(), teamId, name: label.name, color: label.color },
        nativeFingerprint: digest(label),
      };
      await writeEntityState(tx, job.workspace_id, 'label-provision', stateId, value);
      return value;
    });
    const fields = SOURCE_MODELS.issueLabels.fields + ' isGroup';
    const result = await requestLinear(
      env,
      `query ProvisionLookup($name:String!,$team:ID!){issueLabels(first:3,includeArchived:true,filter:{name:{eq:$name},team:{id:{eq:$team}}}){nodes{${fields}}pageInfo{hasNextPage}}}`,
      { name: label.name, team: teamId },
      options,
    );
    const page = result.issueLabels;
    assert(
      Array.isArray(page?.nodes) && page.pageInfo?.hasNextPage === false,
      409,
      'SYNC_LABEL_LOOKUP_INCOMPLETE',
      'Cannot prove a unique source label',
    );
    assert(
      page.nodes.every((r) => uuid(r.id) && r.name === label.name && r.team?.id === teamId),
      409,
      'SYNC_LABEL_LOOKUP_MISMATCH',
      'Label lookup returned a different identity',
    );
    const matches = page.nodes.filter((r) => !r.archivedAt && !r.isGroup);
    assert(
      matches.length <= 1,
      409,
      'SYNC_SOURCE_ALIAS_AMBIGUOUS',
      'More than one label matches this team',
    );
    let record = matches[0];
    if (!record) {
      assert(
        page.nodes.length === 0,
        409,
        'SYNC_LABEL_SOURCE_ARCHIVED',
        'An archived or group label needs explicit reconciliation',
      );
      await db.transaction(async (tx) => {
        await assertJobFence(tx, job);
        assert(
          digest(await loadNative(tx, job.config, 'issueLabels', label.id)) ===
            intent.nativeFingerprint,
          409,
          'SYNC_LABEL_CHANGED',
          'Label changed before source creation',
        );
      });
      const created = await requestLinear(
        env,
        `mutation ProvisionCreate($input:IssueLabelCreateInput!){issueLabelCreate(input:$input){success issueLabel{${fields}}}}`,
        { input: intent.input },
        options,
      );
      record = created.issueLabelCreate?.issueLabel;
      assert(
        created.issueLabelCreate?.success && record?.id === intent.input.id,
        502,
        'SOURCE_CREATE_UNCONFIRMED',
        'Source label creation was not confirmed',
      );
    }
    assert(
      record.name === label.name &&
        record.team?.id === teamId &&
        !record.archivedAt &&
        !record.isGroup,
      409,
      'SYNC_LABEL_LOOKUP_MISMATCH',
      'Created label differs from the planned identity',
    );
    await db.transaction(async (tx) => {
      await assertJobFence(tx, job);
      const current = await loadNative(tx, job.config, 'issueLabels', label.id);
      if (!current || current.name !== label.name) throw new SourceError('SYNC_LABEL_CHANGED', 5);
      await registerSource(tx, job.config, 'issueLabels', record, label.id);
      await writeEntityState(tx, job.workspace_id, 'label-provision', stateId, {
        ...intent,
        completed: true,
        sourceLabelId: record.id,
      });
    });
  }
  return { provisioned: snapshot.missing.length };
}
