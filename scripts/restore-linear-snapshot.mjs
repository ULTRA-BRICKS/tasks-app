// Restores a verified Linear snapshot (scripts/export-linear-snapshot.mjs + download-linear-files.mjs)
// into an ISOLATED local PostgreSQL that already ran `db.mjs migrate` and `db.mjs bootstrap`.
// It only ever connects to loopback and never touches Linear. Replaces nothing: re-running the same plan
// is idempotent, and the bootstrap account/membership are left unchanged.
// Usage: TEST_DATABASE_URL=postgres://...@127.0.0.1:PORT/DB bun scripts/restore-linear-snapshot.mjs \
//   --snapshot DIR --workspace-slug SLUG --report FILE --objects DIR
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { canonical, collections, loadSnapshot } from '../packages/imports/linear-source.mjs';
import { createDatabase } from '../packages/db/index.mjs';
import { createStorage } from '../packages/server/modules/attachments/service.mjs';
import {
  applyImport,
  createImport,
  planImport,
  stageRecords,
} from '../packages/server/modules/linear-import/service.mjs';
import {
  markUnavailable,
  uploadImportFile,
} from '../packages/server/modules/linear-import/files.mjs';

const { values } = parseArgs({
  strict: true,
  options: {
    snapshot: { type: 'string' },
    'workspace-slug': { type: 'string' },
    report: { type: 'string' },
    objects: { type: 'string' },
  },
});
if (!values.snapshot || !values['workspace-slug'] || !values.report || !values.objects)
  throw new Error('Use --snapshot, --workspace-slug, --report and --objects');
const connection = process.env.TEST_DATABASE_URL;
if (!connection) throw new Error('Provide TEST_DATABASE_URL');
const url = new URL(connection);
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname))
  throw new Error('Refusing a non-loopback database');
const snapshot = await loadSnapshot(values.snapshot);
const db = await createDatabase({ url: connection });
const started = Date.now();
try {
  const owner = await db.transaction(
    (tx) =>
      tx.one(
        "SELECT m.user_id,m.workspace_id FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE w.slug=? AND m.role='owner' ORDER BY m.user_id LIMIT 1",
        [values['workspace-slug']],
      ),
    { readOnly: true },
  );
  if (!owner) throw new Error('No owner for the selected workspace; run db.mjs bootstrap first');
  const actor = {
    id: owner.user_id,
    workspace_id: owner.workspace_id,
    role: 'owner',
    scopes: ['read', 'write', 'admin'],
  };
  const transaction = (fn) =>
    db.transaction(async (tx) => {
      await tx.lock(actor.workspace_id);
      return fn(tx);
    });
  const run = await transaction((tx) => createImport(tx, actor, snapshot.manifest));
  for (const collection of collections) {
    const rows = snapshot.data[collection];
    for (let offset = 0; offset < rows.length; offset += 100)
      await transaction((tx) =>
        stageRecords(tx, actor, run.id, collection, rows.slice(offset, offset + 100)),
      );
    console.log('Staged', collection, rows.length);
  }
  let plan = await transaction((tx) => planImport(tx, actor, run.id));
  const fileRoot = resolve(values.snapshot, 'private-files');
  const fileManifest = JSON.parse(await readFile(resolve(fileRoot, 'files.json'), 'utf8'));
  const storage = createStorage({ UPLOAD_DIR: resolve(values.objects) });
  let verified = 0;
  const unavailable = {};
  for (const file of plan.files) {
    const saved = fileManifest.files[file.source_hash];
    if (saved) {
      if (!/^[a-f0-9]{64}$/.test(saved.sha256)) throw new Error('Invalid private file digest');
      const bytes = await readFile(resolve(fileRoot, saved.sha256));
      if (bytes.length !== saved.bytes) throw new Error('Source file size mismatch');
      await uploadImportFile(
        db,
        storage,
        actor,
        run.id,
        file.id,
        bytes,
        {
        sha256: saved.sha256,
        mime: saved.content_type,
        filename: 'linear-' + file.source_hash.slice(0, 12),
        },
        { maxBytes: 100 * 1024 * 1024 },
      );
      verified++;
    } else {
      const code = fileManifest.failures[file.source_hash]?.code;
      if (!['SOURCE_HTTP_404', 'SOURCE_HTTP_410'].includes(code))
        throw new Error('Unverified source file remains: ' + (code ?? 'not attempted'));
      await transaction((tx) =>
        markUnavailable(tx, actor, run.id, file.id, Number(code.slice(-3))),
      );
      unavailable[code] = (unavailable[code] ?? 0) + 1;
    }
  }
  plan = await transaction((tx) => planImport(tx, actor, run.id));
  console.log('Files verified', verified, 'source-unavailable', JSON.stringify(unavailable));
  const options = { rehearsal: false, acceptMissing: Object.keys(unavailable).length > 0 };
  const applied = await transaction((tx) =>
    applyImport(tx, actor, run.id, plan.plan_hash, options),
  );
  const retried = await transaction((tx) =>
    applyImport(tx, actor, run.id, plan.plan_hash, options),
  );
  if (canonical(applied) !== canonical(retried)) throw new Error('Replay changed the result');
  const counts = {};
  await db.transaction(
    async (tx) => {
      for (const table of [
        'users',
        'memberships',
        'workspaces',
        'teams',
        'statuses',
        'labels',
        'issue_labels',
        'issues',
        'comments',
        'projects',
        'project_teams',
        'milestones',
        'cycles',
        'initiatives',
        'initiative_projects',
        'documents',
        'relations',
        'external_links',
        'activity',
        'source_people',
        'linear_import_records',
      ])
        counts[table] = Number((await tx.one('SELECT COUNT(*) AS n FROM ' + table)).n);
    },
    { readOnly: true },
  );
  const report = {
    mode: 'isolated-local-restore',
    source: snapshot.manifest.organization,
    run_id: run.id,
    workspace_id: actor.workspace_id,
    elapsed_ms: Date.now() - started,
    source_hash: snapshot.normalizedHash,
    files_verified: verified,
    files_source_unavailable: unavailable,
    counts,
    applied,
    replay_unchanged: true,
  };
  await writeFile(values.report, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ counts, private_files_pending: applied.private_files_pending }));
} finally {
  await db.close();
}
