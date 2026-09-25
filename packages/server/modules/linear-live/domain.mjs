import { assert } from '../../core/errors.mjs';
import { now } from '../../core/crypto.mjs';
import { targetId } from '../../../imports/linear-source.mjs';
import { validate } from '../../../contracts/validate.mjs';
import { schemas } from '../../../contracts/schemas.mjs';
import { updateIssue, addRelation } from '../tickets/service.mjs';
import { createProject, updateProject, createMilestone, createCycle, updateCycle } from '../planning/service.mjs';
import { createKnowledge, updateKnowledge } from '../knowledge/service.mjs';
import { appendLinearRecords } from '../linear-import/append.mjs';
import { TABLES } from './model.mjs';
import { loadNative, registerSource } from './context.mjs';
export async function applyNativePatch(tx, config, collection, row, patch) {
  if (!Object.keys(patch).length) return row;
  const actor = config.actor;
  if (collection === 'issues')
    return updateIssue(tx, actor, row.id, { version: row.version, ...patch });
  if (collection === 'projects')
    return updateProject(tx, actor, row.id, { version: row.version, ...patch });
  if (collection === 'cycles')
    return updateCycle(tx, actor, row.id, { version: row.version, ...patch });
  if (['documents', 'initiatives'].includes(collection))
    return updateKnowledge(tx, actor, collection, row.id, { version: row.version, ...patch });
  if (collection === 'comments') {
    assert(
      !Object.hasOwn(patch, 'issue_id') || patch.issue_id === row.issue_id,
      409,
      'SYNC_COMMENT_MOVED',
      'Comment parent identity changed',
    );
    if (Object.hasOwn(patch, 'body')) {
      validate({ body: patch.body }, schemas.Comment);
      const changed = await tx.exec(
        'UPDATE comments SET body=?,version=version+1,updated_at=? WHERE workspace_id=? AND id=? AND version=?',
        [patch.body, now(), config.workspaceId, row.id, row.version],
      );
      assert(
        Number(changed.changes) === 1,
        409,
        'VERSION_CONFLICT',
        'Comment changed concurrently',
      );
    }
    return loadNative(tx, config, collection, row.id);
  }
  const allowed = {
    users: ['name', 'email', 'avatar_url'],
    teams: ['name'],
    workflowStates: ['name', 'color', 'position', 'category'],
    issueLabels: ['name', 'color'],
    projectMilestones: ['name', 'target_date', 'position'],
    attachments: ['title', 'url'],
  };
  const keys = Object.keys(patch);
  assert(
    keys.every((k) => allowed[collection]?.includes(k)),
    409,
    'SYNC_STRUCTURAL_CHANGE',
    'Structural metadata changes require explicit resolution',
  );
  await tx.exec(
    `UPDATE ${TABLES[collection]} SET ${keys.map((k) => k + '=?').join(',')} WHERE workspace_id=? AND id=?`,
    [...keys.map((k) => patch[k]), config.workspaceId, row.id],
  );
  return loadNative(tx, config, collection, row.id);
}
export async function createNativeSource(tx, config, collection, record, fields) {
  const actor = config.actor,
    workspace = config.workspaceId;
  let row;
  if (['issues', 'comments'].includes(collection)) {
    const input = {
      source_workspace_id: config.organizationId,
      issues: collection === 'issues' ? [record] : [],
      comments:
        collection === 'comments'
          ? [{ ...record, issueId: record.issue?.id ?? record.issueId }]
          : [],
    };
    const plan = await appendLinearRecords(tx, actor, input);
    const applied = await appendLinearRecords(tx, actor, { ...input, plan_hash: plan.plan_hash });
    const created = (collection === 'issues' ? applied.issues : applied.comments).find(
      (r) => r.source_id === record.id,
    );
    assert(created, 409, 'SYNC_APPEND_NOT_APPLIED', 'Source append has no target receipt');
    return loadNative(tx, config, collection, created.id);
  }
  if (collection === 'projects') {
    validate(fields, schemas.ProjectCreate);
    row = await createProject(tx, actor, fields);
  } else if (collection === 'cycles') row = await createCycle(tx, actor, fields);
  else if (collection === 'projectMilestones') row = await createMilestone(tx, actor, fields);
  else if (collection === 'documents' || collection === 'initiatives')
    row = await createKnowledge(tx, actor, collection, fields);
  else if (collection === 'issueRelations') {
    row = await tx.one(
      'SELECT * FROM relations WHERE workspace_id=? AND source_id=? AND target_id=? AND type=?',
      [workspace, fields.source_id, fields.target_id, fields.type],
    );
    if (!row)
      row = await addRelation(tx, actor, fields.source_id, {
        target_id: fields.target_id,
        type: fields.type,
      });
  } else if (collection === 'attachments') {
    const url = new URL(fields.url);
    assert(
      ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password,
      422,
      'INVALID_SOURCE_URL',
      'Unsafe attachment URL',
    );
    row = {
      id: targetId(workspace, config.organizationId, 'attachments', record.id),
      workspace_id: workspace,
      ...fields,
      provider: 'linear-attachment',
      external_id: record.id,
    };
    await tx.exec(
      'INSERT INTO external_links(id,workspace_id,issue_id,provider,external_id,title,url) VALUES(?,?,?,?,?,?,?)',
      [row.id, workspace, row.issue_id, row.provider, row.external_id, row.title, row.url],
    );
  } else if (collection === 'projectUpdates' || collection === 'initiativeUpdates') {
    row = await createKnowledge(tx, actor, 'documents', {
      title: 'Update · ' + record.createdAt.slice(0, 10),
      body: record.body,
      project_id: fields.project_id,
      initiative_id: fields.initiative_id,
    });
  } else {
    const wanted = targetId(workspace, config.organizationId, collection, record.id);
    if (collection === 'users') {
      assert(
        typeof fields.name === 'string' && fields.name.length <= 300,
        422,
        'INVALID_SOURCE_PERSON',
        'Invalid source person',
      );
      row = {
        id: wanted,
        workspace_id: workspace,
        provider: 'linear',
        source_id: record.id,
        ...fields,
        created_at: record.createdAt,
      };
    } else if (collection === 'teams') {
      validate(fields, schemas.Team);
      row = await tx.one('SELECT * FROM teams WHERE workspace_id=? AND key=?', [
        workspace,
        fields.key,
      ]);
      if (row)
        assert(
          row.name === fields.name,
          409,
          'SYNC_TEAM_COLLISION',
          'A different native team has the source key',
        );
      else row = { id: wanted, workspace_id: workspace, ...fields, next_number: 1 };
    } else if (collection === 'workflowStates') {
      validate(fields, schemas.Status);
      row = await tx.one('SELECT * FROM statuses WHERE workspace_id=? AND team_id=? AND name=?', [
        workspace,
        fields.team_id,
        fields.name,
      ]);
      if (row)
        assert(
          row.category === fields.category,
          409,
          'SYNC_STATUS_COLLISION',
          'Status semantics differ',
        );
      else row = { id: wanted, workspace_id: workspace, ...fields };
    } else if (collection === 'issueLabels') {
      validate(fields, schemas.Label);
      row = await tx.one('SELECT * FROM labels WHERE workspace_id=? AND name=?', [
        workspace,
        fields.name,
      ]);
      if (!row) row = { id: wanted, workspace_id: workspace, ...fields };
    } else assert(false, 422, 'SYNC_MODEL_UNSUPPORTED', 'Native source model is not implemented');
    if (row.id === wanted) {
      const keys = Object.keys(row);
      await tx.exec(
        `INSERT INTO ${TABLES[collection]}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`,
        Object.values(row),
      );
    }
  }
  assert(row?.id, 500, 'SYNC_TARGET_MISSING', 'Native creation returned no identity');
  await registerSource(tx, config, collection, record, row.id);
  return loadNative(tx, config, collection, row.id);
}
export async function assignLinearCode(tx, config, row, record) {
  const policy = await tx.one(
    "SELECT config FROM module_settings WHERE workspace_id=? AND module='linear-numbering' AND enabled=1",
    [config.workspaceId],
  );
  if (!policy) return row;
  assert(
    /^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]*$/.test(record.identifier) &&
      Number.isInteger(record.number) &&
      record.number > 0 &&
      record.number < 2147483647,
    422,
    'INVALID_SOURCE_CODE',
    'Source code is invalid',
  );
  if (row.key === record.identifier && row.number === record.number) return row;
  const team = await tx.one('SELECT key FROM teams WHERE workspace_id=? AND id=?', [
    config.workspaceId,
    row.team_id,
  ]);
  assert(
    record.identifier === team.key + '-' + record.number,
    409,
    'SYNC_TEAM_CHANGE',
    'Source team must be reconciled before its code',
  );
  const other = await tx.one(
    'SELECT id FROM issues WHERE workspace_id=? AND (key=? OR (team_id=? AND number=?)) AND id<>?',
    [config.workspaceId, record.identifier, row.team_id, record.number, row.id],
  );
  assert(
    !other,
    409,
    'SYNC_CODE_COLLISION',
    'Source code belongs to another native task; identity review required',
  );
  const changed = await tx.exec(
    'UPDATE issues SET key=?,number=?,version=version+1,updated_at=? WHERE workspace_id=? AND id=? AND version=?',
    [record.identifier, record.number, now(), config.workspaceId, row.id, row.version],
  );
  assert(
    Number(changed.changes) === 1,
    409,
    'VERSION_CONFLICT',
    'Task changed before code assignment',
  );
  return loadNative(tx, config, 'issues', row.id);
}
