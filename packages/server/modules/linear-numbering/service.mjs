import { applyCodeChanges, applyReferenceEdits } from './apply.mjs';
import { assert, requirePermission } from '../../core/errors.mjs';
import { now } from '../../core/crypto.mjs';
import { canonical, digest, targetId, uuid } from '../../../imports/linear-source.mjs';
import { planReferenceEdits } from './references.mjs';
const DOCS = Object.freeze({
  issues: ['title', 'description'],
  comments: ['body'],
  projects: ['name', 'description'],
  documents: ['title', 'body'],
  initiatives: ['name', 'description'],
  external_links: ['title', 'url'],
  milestones: ['name'],
  cycles: ['name'],
  saved_views: ['name', 'filters'],
});
export async function numberingGraph(tx, actor) {
  requirePermission(actor, 'admin');
  const issues = await tx.all('SELECT * FROM issues WHERE workspace_id=? ORDER BY id', [
    actor.workspace_id,
  ]);
  const mappings = await tx.all(
    'SELECT m.source_workspace_id,m.source_id,m.target_id,m.collection,m.import_id,r.payload,i.manifest FROM linear_source_map m JOIN linear_import_records r ON r.workspace_id=m.workspace_id AND r.import_id=m.import_id AND r.collection=m.collection AND r.source_id=m.source_id JOIN linear_imports i ON i.id=m.import_id AND i.workspace_id=m.workspace_id WHERE m.workspace_id=? ORDER BY m.collection,m.source_id',
    [actor.workspace_id],
  );
  const texts = [];
  for (const [table, fields] of Object.entries(DOCS)) {
    const records =
      table === 'issues'
        ? issues
        : await tx.all('SELECT * FROM ' + table + ' WHERE workspace_id=? ORDER BY id', [
            actor.workspace_id,
          ]);
    for (const row of records)
      for (const field of fields)
        if (typeof row[field] === 'string' && row[field])
          texts.push({
            table,
            id: row.id,
            field,
            text: row[field],
            version: row.version ?? null,
            createdAt: row.created_at ?? null,
            provider: row.provider ?? null,
          });
  }
  const teams = await tx.all('SELECT * FROM teams WHERE workspace_id=? ORDER BY id', [
    actor.workspace_id,
  ]);
  const links = await tx.all(
    'SELECT id,issue_id,provider,external_id,url,title FROM external_links WHERE workspace_id=? ORDER BY id',
    [actor.workspace_id],
  );
  return { workspace: actor.workspace_id, issues, mappings, teams, texts, links };
}
function originOf(doc, maps) {
  if (doc.table === 'external_links' && doc.provider === 'linear') return 'linear';
  const alias = {
    milestones: 'projectMilestones',
    external_links: 'attachments',
    saved_views: 'customViews',
  };
  const record = maps.get((alias[doc.table] ?? doc.table) + ':' + doc.id);
  if (!record) return 'tasks';
  const source = JSON.parse(record.payload),
    manifest = JSON.parse(record.manifest);
  if (manifest.operation === 'explicit-source-binding') return 'tasks';
  const sourceField =
    doc.field === 'body'
      ? doc.table === 'comments'
        ? 'body'
        : 'content'
      : doc.field === 'description' && ['projects', 'initiatives'].includes(doc.table)
        ? 'content'
        : doc.field;
  const baseline =
    source[sourceField] ?? (sourceField === 'content' ? source.description : null) ?? '';
  return baseline === doc.text ? 'linear' : 'mixed';
}
export async function canonicalNumbering(tx, actor, input, options = {}) {
  requirePermission(actor, 'admin');
  assert(
    uuid(input.source_workspace_id) &&
      Array.isArray(input.records) &&
      input.records.length > 0 &&
      input.records.length <= 10000,
    422,
    'INVALID_NUMBERING_SNAPSHOT',
    'A bounded verified source snapshot is required',
  );
  const organization = input.source_workspace_id;
  const source = new Map(),
    codes = new Set();
  for (const r of input.records) {
    assert(
      uuid(r.source_id) &&
        uuid(r.team_id) &&
        /^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]*$/.test(r.code) &&
        Number(r.code.split('-').at(-1)) < 2147483647,
      422,
      'INVALID_SOURCE_CODE',
      'Invalid source identity or code',
    );
    assert(
      !source.has(r.source_id) && !codes.has(r.code),
      422,
      'DUPLICATE_SOURCE_CODE',
      'Source codes and identities must be unique',
    );
    source.set(r.source_id, r);
    codes.add(r.code);
  }
  const requestHash = digest({
    organization,
    records: input.records,
    decisions: input.reference_decisions ?? {},
  });
  const receiptId = targetId(actor.workspace_id, organization, 'canonical-numbering', requestHash);
  const previous = await tx.one(
    "SELECT payload FROM outbox WHERE workspace_id=? AND id=? AND provider='linear-numbering' AND status='state'",
    [actor.workspace_id, receiptId],
  );
  if (previous) {
    const saved = JSON.parse(previous.payload);
    assert(
      !input.plan_hash || input.plan_hash === saved.plan_hash,
      409,
      'PLAN_CHANGED',
      'Completed numbering receipt has a different plan',
    );
    return { ...saved.result, unchanged: true };
  }

  if (input.plan_hash) {
    await tx.lock(actor.workspace_id);
    // One-off cutover: freeze DML before reading the authoritative graph, including writers outside REST.
    // Bounded wait fails/rolls back safely instead of holding user writes indefinitely.
    if (tx.dialect === 'postgres') {
      await tx.exec("SET LOCAL lock_timeout='5s'");
      await tx.exec(
        'LOCK TABLE issues,comments,projects,documents,initiatives,teams,external_links,milestones,cycles,saved_views,linear_source_map,linear_import_records IN SHARE ROW EXCLUSIVE MODE',
      );
    }
  }
  const graph = await numberingGraph(tx, actor);
  const scoped = graph.mappings.filter((r) => r.source_workspace_id === organization),
    teamMap = new Map(
      scoped.filter((r) => r.collection === 'teams').map((r) => [r.source_id, r.target_id]),
    ),
    mapByNative = new Map();
  assert(
    teamMap.size > 0,
    403,
    'SOURCE_ORGANIZATION_MISMATCH',
    'Source organization has no imported teams',
  );
  for (const m of scoped.filter((r) => r.collection === 'issues')) {
    assert(
      !mapByNative.has(m.target_id),
      409,
      'AMBIGUOUS_IDENTITY',
      'Multiple source issue identities map to one native task',
    );
    mapByNative.set(m.target_id, m);
  }
  const pairs = [],
    problems = [];
  const managedTeams = new Set(teamMap.values());
  const teamsById = new Map(graph.teams.map((team) => [team.id, team]));
  for (const issue of graph.issues) {
    if (!managedTeams.has(issue.team_id)) continue;
    const map = mapByNative.get(issue.id),
      record = map ? source.get(map.source_id) : null;
    if (!record) {
      problems.push({
        id: issue.id,
        key: issue.key,
        reason: map ? 'missing-source-record' : 'missing-source-binding',
      });
      continue;
    }
    const team = teamsById.get(issue.team_id);
    if (teamMap.get(record.team_id) !== issue.team_id || !record.code.startsWith(team.key + '-')) {
      problems.push({ id: issue.id, key: issue.key, reason: 'team-identity-mismatch' });
      continue;
    }
    pairs.push({
      id: issue.id,
      sourceId: record.source_id,
      oldCode: issue.key,
      newCode: record.code,
      oldNumber: issue.number,
      newNumber: Number(record.code.split('-').at(-1)),
      teamId: issue.team_id,
      version: issue.version,
    });
  }
  assert(
    problems.length === 0,
    409,
    'NUMBERING_IDENTITY_UNRESOLVED',
    'Resolve missing or contradictory task identities before renumbering',
    { problems },
  );
  const targets = new Set(pairs.map((r) => r.id));
  const finalCodes = new Set(pairs.map((r) => r.newCode));
  for (const issue of graph.issues)
    if (!targets.has(issue.id))
      assert(
        !finalCodes.has(issue.key),
        409,
        'NUMBERING_OCCUPIED',
        'A canonical code is occupied outside the source mapping',
      );
  const changes = pairs.filter((p) => p.oldCode !== p.newCode || p.oldNumber !== p.newNumber);
  const maps = new Map(scoped.map((m) => [m.collection + ':' + m.target_id, m]));
  const edits = [],
    ambiguous = [];
  for (const doc of graph.texts) {
    const location = doc.table + ':' + doc.id + ':' + doc.field,
      origin = originOf(doc, maps);
    const planned = planReferenceEdits(doc.text, {
      appOrigin: options.appOrigin,
      mappings: pairs,
      origin,
      decisions: input.reference_decisions?.[location] ?? {},
    });
    if (planned.edits.length) {
      const { text, ...descriptor } = doc;
      edits.push({
        ...descriptor,
        before: text,
        after: planned.text,
        origin,
        edits: planned.edits,
      });
    }
    for (const item of planned.ambiguous)
      ambiguous.push({
        location,
        origin,
        ...item,
        context: doc.text.slice(Math.max(0, item.start - 80), item.end + 80),
      });
  }
  const planHash = digest({ requestHash, graph, changes, edits, ambiguous });
  const result = {
    id: receiptId,
    plan_hash: planHash,
    applied: false,
    changes,
    referenceChanges: edits.map(({ before, after, ...e }) => ({
      ...e,
      beforeHash: digest(before),
      afterHash: digest(after),
    })),
    ambiguousReferences: ambiguous,
    totalMapped: pairs.length,
  };
  if (!input.plan_hash) return result;
  assert(
    input.plan_hash === planHash,
    409,
    'PLAN_CHANGED',
    'A task, source binding or reference changed after preview',
  );
  assert(
    ambiguous.length === 0,
    409,
    'UNRESOLVED_REFERENCES',
    'Resolve every ambiguous current reference before code cutover',
    { count: ambiguous.length },
  );
  await tx.lock(actor.workspace_id);
  const concurrentReceipt = await tx.one(
    "SELECT payload FROM outbox WHERE workspace_id=? AND id=? AND provider='linear-numbering' AND status='state'",
    [actor.workspace_id, receiptId],
  );
  if (concurrentReceipt) {
    const saved = JSON.parse(concurrentReceipt.payload);
    assert(
      saved.plan_hash === input.plan_hash,
      409,
      'PLAN_CHANGED',
      'Concurrent migration used another plan',
    );
    return { ...saved.result, unchanged: true };
  }
  const stamp = now();
  await applyCodeChanges(tx, actor.workspace_id, changes, graph.issues, receiptId, stamp);
  await applyReferenceEdits(
    tx,
    actor.workspace_id,
    edits,
    new Set(changes.map((c) => c.id)),
    stamp,
  );
  for (const teamId of managedTeams) {
    const highest = Math.max(
      0,
      ...pairs.filter((p) => p.teamId === teamId).map((p) => p.newNumber),
    );
    await tx.exec('UPDATE teams SET next_number=? WHERE workspace_id=? AND id=?', [
      highest + 1,
      actor.workspace_id,
      teamId,
    ]);
  }
  const applied = { ...result, applied: true };
  await tx.exec(
    "INSERT INTO outbox(id,workspace_id,provider,event,payload,status,attempts,next_attempt_at,created_at) VALUES(?,?,'linear-numbering','canonical-migration',?,'state',0,?,?)",
    [
      receiptId,
      actor.workspace_id,
      canonical({
        plan_hash: planHash,
        sourceSnapshot: input.records,
        pairs,
        edits,
        result: applied,
      }),
      stamp,
      stamp,
    ],
  );
  await tx.exec(
    "INSERT INTO module_settings(workspace_id,module,enabled,config) VALUES(?,'linear-numbering',1,?) ON CONFLICT(workspace_id,module) DO UPDATE SET enabled=1,config=excluded.config",
    [
      actor.workspace_id,
      canonical({
        authority: 'linear',
        organizationId: organization,
        migrationId: receiptId,
        teamIds: [...managedTeams],
        activatedAt: stamp,
      }),
    ],
  );
  return applied;
}
