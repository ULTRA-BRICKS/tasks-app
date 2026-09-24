import { insertSourceRows } from './rows.mjs';
import { markdownEquivalent, linearIssueUrl, sourceIdentifier } from './source-contract.mjs';
import { assert, requirePermission } from '../../core/errors.mjs';
import { assertModule } from '../../core/modules.mjs';
import { now } from '../../core/crypto.mjs';
import { canonical, digest, targetId, uuid, collections } from '../../../imports/linear-source.mjs';
const TABLES = Object.freeze({
  issues: 'issues',
  comments: 'comments',
  teams: 'teams',
  workflowStates: 'statuses',
  issueLabels: 'labels',
  users: 'source_people',
  projects: 'projects',
});
export async function bindLinearSources(tx, actor, input) {
  requirePermission(actor, 'admin');
  await assertModule(tx, actor.workspace_id, 'tickets');
  const source = input.source_workspace_id,
    bindings = input.bindings;
  assert(
    uuid(source) && Array.isArray(bindings) && bindings.length > 0 && bindings.length <= 50,
    422,
    'INVALID_BINDINGS',
    'Provide a source organization and one to fifty explicit bindings',
  );
  assert(
    new Set(bindings.map((b) => b.collection + ':' + b.record?.id)).size === bindings.length,
    422,
    'DUPLICATE_SOURCE_ID',
    'Source IDs may not repeat',
  );
  if (input.plan_hash) await tx.lock(actor.workspace_id);
  const root = await tx.one(
    "SELECT id,manifest FROM linear_imports WHERE workspace_id=? AND source_workspace_id=? AND status='completed' ORDER BY created_at,id LIMIT 1",
    [actor.workspace_id, source],
  );
  assert(
    root,
    403,
    'ORGANIZATION_NOT_ALLOWED',
    'The source organization is not imported into this workspace',
  );
  const requestHash = digest({ source, bindings, actor: actor.id }),
    runId = targetId(actor.workspace_id, source, 'binding-batch', requestHash);
  const previous = await tx.one(
    "SELECT result,plan_hash FROM linear_imports WHERE workspace_id=? AND id=? AND status='completed'",
    [actor.workspace_id, runId],
  );
  if (previous) {
    assert(
      !input.plan_hash || input.plan_hash === previous.plan_hash,
      409,
      'PLAN_CHANGED',
      'Binding plan hash does not match',
    );
    return { ...JSON.parse(previous.result), unchanged: true };
  }
  const resolved = [];
  const claimedTargets = new Map();
  let comparedBytes = 0;
  for (const binding of bindings) {
    const { collection, record, target_id: target } = binding;
    assert(
      Object.hasOwn(TABLES, collection) && uuid(record?.id) && uuid(target),
      422,
      'INVALID_BINDING',
      'Unsupported collection or invalid UUID',
    );
    assert(
      canonical(record).length <= 1000000,
      413,
      'SOURCE_RECORD_TOO_LARGE',
      'Source record exceeds the storage bound',
    );
    const targetKey = collection + ':' + target;
    if (collection !== 'issueLabels') {
      assert(
        !claimedTargets.has(targetKey) || claimedTargets.get(targetKey) === record.id,
        409,
        'AMBIGUOUS_TARGET',
        'Distinct source records cannot share a native target',
      );
      claimedTargets.set(targetKey, record.id);
    }
    const prior = await tx.one(
      'SELECT target_id FROM linear_source_map WHERE workspace_id=? AND source_workspace_id=? AND collection=? AND source_id=?',
      [actor.workspace_id, source, collection, record.id],
    );
    assert(
      !prior || prior.target_id === target,
      409,
      'SOURCE_MAPPING_CONFLICT',
      'An existing source UUID may not be rebound to another entity',
    );
    const native = await tx.one(
      'SELECT * FROM ' + TABLES[collection] + ' WHERE workspace_id=? AND id=?',
      [actor.workspace_id, target],
    );
    assert(native, 404, 'TARGET_NOT_FOUND', 'The native target does not exist in this workspace');
    comparedBytes += Buffer.byteLength(canonical(native)) + Buffer.byteLength(canonical(record));
    assert(
      comparedBytes <= 2000000,
      413,
      'BINDING_COMPARE_BUDGET',
      'Use smaller binding batches for large documents',
    );
    if (collection !== 'issueLabels') {
      const others = await tx.all(
        'SELECT source_id FROM linear_source_map WHERE workspace_id=? AND source_workspace_id=? AND collection=? AND target_id=?',
        [actor.workspace_id, source, collection, target],
      );
      assert(
        others.every((o) => o.source_id === record.id),
        409,
        'AMBIGUOUS_TARGET',
        'Distinct source tasks or comments cannot be merged into one native target',
      );
    }
    if (collection === 'issues') {
      assert(
        record.title === native.title &&
          markdownEquivalent(record.description ?? '', native.description),
        409,
        'CONTENT_NOT_CONVERGED',
        'Bind only after source and native title/body have converged',
      );
      linearIssueUrl(record.url);
      sourceIdentifier(record);
    }
    if (collection === 'comments')
      assert(
        markdownEquivalent(record.body, native.body),
        409,
        'CONTENT_NOT_CONVERGED',
        'Comment bodies must converge before binding',
      );
    if (collection === 'issueLabels')
      assert(
        record.name === native.name,
        409,
        'LABEL_NAME_MISMATCH',
        'Label binding requires matching names',
      );
    if (collection === 'teams')
      assert(
        record.key === native.key && record.name === native.name,
        409,
        'CONTENT_NOT_CONVERGED',
        'Team name and key must agree',
      );
    if (collection === 'users')
      assert(
        typeof record.email === 'string' &&
          record.email.trim().toLowerCase() === native.email?.trim().toLowerCase() &&
          record.name === native.name,
        409,
        'CONTENT_NOT_CONVERGED',
        'Source person email and name must agree',
      );
    if (collection === 'workflowStates')
      assert(
        record.name === native.name && record.type === native.category,
        409,
        'CONTENT_NOT_CONVERGED',
        'Status name and category must agree',
      );
    if (collection === 'projects') {
      await assertModule(tx, actor.workspace_id, 'planning');
      assert(
        record.name === native.name &&
          markdownEquivalent(record.content ?? record.description ?? '', native.description),
        409,
        'CONTENT_NOT_CONVERGED',
        'Project name and body must agree',
      );
    }
    if (
      ![
        'issues',
        'comments',
        'teams',
        'users',
        'workflowStates',
        'issueLabels',
        'projects',
      ].includes(collection)
    )
      assert(
        false,
        422,
        'UNSUPPORTED_BINDING',
        'This source binding type has not been implemented',
      );
    resolved.push({
      collection,
      source_id: record.id,
      target_id: target,
      record,
      native,
      exists: Boolean(prior),
    });
  }
  const planHash = digest({
    requestHash,
    targets: resolved.map((r) => ({
      collection: r.collection,
      id: r.target_id,
      native: r.native,
      exists: r.exists,
    })),
  });
  const result = {
    id: runId,
    plan_hash: planHash,
    applied: false,
    bindings: resolved.map(({ collection, source_id, target_id, exists }) => ({
      collection,
      source_id,
      target_id,
      unchanged: exists,
    })),
  };
  if (!input.plan_hash) return result;
  assert(
    input.plan_hash === planHash,
    409,
    'PLAN_CHANGED',
    'A native target changed after planning',
  );
  const stamp = now(),
    counts = Object.fromEntries(
      collections.map((c) => [c, resolved.filter((r) => r.collection === c).length]),
    );
  const manifest = {
    format: 'tickets-linear-snapshot-v1',
    operation: 'explicit-source-binding',
    organization: { id: source },
    base_import_id: root.id,
    verifiedAt: JSON.parse(root.manifest).verifiedAt ?? stamp,
    counts,
  };
  await tx.exec(
    "INSERT INTO linear_imports(id,workspace_id,source_workspace_id,status,manifest,plan_hash,created_by,created_at) VALUES(?,?,?,'staging',?,?,?,?)",
    [runId, actor.workspace_id, source, canonical(manifest), planHash, actor.id, stamp],
  );
  const stored = resolved.map((item) => ({
    ...item,
    payload: canonical(item.record),
    hash: digest(item.record),
  }));
  await insertSourceRows(
    tx,
    'linear_import_records',
    stored.map((item) => ({
      workspace_id: actor.workspace_id,
      import_id: runId,
      collection: item.collection,
      source_id: item.source_id,
      payload: item.payload,
      payload_hash: item.hash,
    })),
  );
  await insertSourceRows(
    tx,
    'linear_source_map',
    stored
      .filter((item) => !item.exists)
      .map((item) => ({
        workspace_id: actor.workspace_id,
        source_workspace_id: source,
        collection: item.collection,
        source_id: item.source_id,
        target_id: item.target_id,
        payload_hash: item.hash,
        import_id: runId,
      })),
  );
  const issueBindings = stored.filter((item) => item.collection === 'issues');
  if (issueBindings.length) {
    const existing = await tx.all(
      `SELECT external_id,issue_id FROM external_links WHERE workspace_id=? AND provider='linear' AND external_id IN (${issueBindings.map(() => '?').join(',')})`,
      [actor.workspace_id, ...issueBindings.map((item) => item.source_id)],
    );
    const keys = new Set(existing.map((row) => row.external_id + ':' + row.issue_id));
    await insertSourceRows(
      tx,
      'external_links',
      issueBindings
        .filter((item) => !keys.has(item.source_id + ':' + item.target_id))
        .map((item) => ({
          id: targetId(actor.workspace_id, source, 'linear-link', item.source_id),
          workspace_id: actor.workspace_id,
          issue_id: item.target_id,
          provider: 'linear',
          external_id: item.source_id,
          url: item.record.url,
          title: item.record.identifier,
        })),
    );
  }
  const applied = { ...result, applied: true };
  await tx.exec(
    "UPDATE linear_imports SET status='completed',completed_at=?,result=? WHERE workspace_id=? AND id=?",
    [stamp, canonical(applied), actor.workspace_id, runId],
  );
  return applied;
}
