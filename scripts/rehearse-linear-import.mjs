import { resolve } from 'node:path';
import { createStorage } from '../packages/server/modules/attachments/service.mjs';
import {
  uploadImportFile,
  markUnavailable,
} from '../packages/server/modules/linear-import/files.mjs';
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { loadSnapshot, collections, canonical } from '../packages/imports/linear-source.mjs';
import { createDatabase, migrate } from '../packages/db/index.mjs';
import {
  createImport,
  stageRecords,
  planImport,
  applyImport,
} from '../packages/server/modules/linear-import/service.mjs';
const { values } = parseArgs({
  strict: true,
  options: {
    snapshot: { type: 'string' },
    workspace: { type: 'string' },
    report: { type: 'string' },
    'expected-host': { type: 'string' },
    'url-stdin': { type: 'boolean' },
    'rehearsal-only': { type: 'boolean' },
    'file-pass': { type: 'boolean' },
  },
});
if (
  !values['rehearsal-only'] ||
  !values.snapshot ||
  !values.workspace ||
  !values.report ||
  !values['expected-host']
)
  throw new Error(
    'This command only supports an explicitly selected rehearsal branch, snapshot, workspace and report.',
  );
let connection = process.env.TEST_DATABASE_URL;
if (values['url-stdin']) {
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk;
    if (text.length > 4096) throw new Error('Invalid connection input');
  }
  connection = text.trim();
}
if (!connection) throw new Error('Provide rehearsal TEST_DATABASE_URL or --url-stdin');
const url = new URL(connection);
if (url.hostname !== values['expected-host'] || !url.hostname.endsWith('.neon.tech'))
  throw new Error('Unexpected target host; refusing to connect');
const snapshot = await loadSnapshot(values.snapshot);
const db = await createDatabase({ url: connection });
const started = Date.now();
try {
  const evidence = await db.transaction(
    (tx) => tx.one("SELECT details FROM linear_import_rehearsal.checkpoints WHERE name='scope'"),
    { readOnly: true },
  );
  const scope =
    typeof evidence?.details === 'string' ? JSON.parse(evidence.details) : evidence?.details;
  if (
    scope?.status !== 'rehearsal_only' ||
    scope.production_applied !== false ||
    scope.target_workspace !== values.workspace
  )
    throw new Error('Rehearsal marker missing or mismatched; no migration or import performed');
  await migrate(db);
  const owner = await db.transaction(
    (tx) =>
      tx.one(
        "SELECT user_id FROM memberships WHERE workspace_id=? AND role='owner' ORDER BY user_id LIMIT 1",
        [values.workspace],
      ),
    { readOnly: true },
  );
  if (!owner) throw new Error('The selected rehearsal workspace has no owner');
  const actor = {
    id: owner.user_id,
    workspace_id: values.workspace,
    role: 'owner',
    scopes: ['read', 'write', 'admin'],
  };
  const transaction = (fn) =>
    db.transaction(async (tx) => {
      await tx.lock(actor.workspace_id);
      return fn(tx);
    });
  if (values['file-pass'])
    snapshot.manifest = { ...snapshot.manifest, verification_pass: 'private-file-rehearsal-v1' };
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
  if (values['file-pass'] && plan.status !== 'completed') {
    const fileRoot = resolve(values.snapshot, 'private-files');
    const fileManifest = JSON.parse(await readFile(resolve(fileRoot, 'files.json'), 'utf8'));
    const storage = createStorage({
      NODE_ENV: 'test',
      UPLOAD_DIR: resolve(values.snapshot, 'rehearsal-private-objects'),
    });
    let verified = 0,
      unavailable = 0;
    for (const file of plan.files) {
      const saved = fileManifest.files[file.source_hash];
      if (saved) {
        if (!/^[a-f0-9]{64}$/.test(saved.sha256)) throw new Error('Invalid private file digest');
        const bytes = await readFile(resolve(fileRoot, saved.sha256));
        if (bytes.length !== saved.bytes) throw new Error('Source file size mismatch');
        await uploadImportFile(db, storage, actor, run.id, file.id, bytes, {
          sha256: saved.sha256,
          mime: saved.content_type,
          filename: 'linear-' + file.source_hash.slice(0, 12),
        });
        verified++;
      } else {
        const failure = fileManifest.failures[file.source_hash]?.code;
        if (!['SOURCE_HTTP_404', 'SOURCE_HTTP_410'].includes(failure))
          throw new Error('Unverified source file remains');
        await transaction((tx) =>
          markUnavailable(tx, actor, run.id, file.id, Number(failure.slice(-3))),
        );
        unavailable++;
      }
    }
    plan = await transaction((tx) => planImport(tx, actor, run.id));
    console.log(
      'Private object readback verified:',
      verified,
      'source-unavailable references preserved:',
      unavailable,
    );
  }
  const applied = await transaction((tx) =>
    applyImport(tx, actor, run.id, plan.plan_hash, {
      rehearsal: !values['file-pass'],
      acceptMissing: Boolean(values['file-pass']),
    }),
  );
  const retried = await transaction((tx) =>
    applyImport(tx, actor, run.id, plan.plan_hash, {
      rehearsal: !values['file-pass'],
      acceptMissing: Boolean(values['file-pass']),
    }),
  );
  if (canonical(applied) !== canonical(retried)) throw new Error('Replay changed the result');
  const counts = await db.transaction(
    async (tx) => {
      const result = {};
      for (const table of [
        'issues',
        'comments',
        'projects',
        'milestones',
        'initiatives',
        'documents',
        'relations',
        'activity',
        'source_people',
        'users',
        'memberships',
        'linear_import_records',
      ]) {
        result[table] = Number((await tx.one('SELECT COUNT(*) AS n FROM ' + table)).n);
      }
      return result;
    },
    { readOnly: true },
  );
  const report = {
    mode: 'isolated-rehearsal',
    source: snapshot.manifest.organization,
    run_id: run.id,
    branch_host: url.hostname,
    elapsed_ms: Date.now() - started,
    source_hash: snapshot.normalizedHash,
    counts,
    applied,
    replay_unchanged: true,
    production_changed: false,
  };
  await writeFile(values.report, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(
    JSON.stringify(
      {
        mode: report.mode,
        counts,
        private_files_pending: applied.private_files_pending,
        replay_unchanged: true,
        elapsed_ms: report.elapsed_ms,
      },
      null,
      2,
    ),
  );
} finally {
  await db.close();
}
