import { assert, missing, requirePermission } from '../../core/errors.mjs';
import { sha256, now } from '../../core/crypto.mjs';
import { targetId, digest } from '../../../imports/linear-source.mjs';
import { MAX_UPLOAD } from '../attachments/service.mjs';

export async function prepareFiles(tx, actor, run, urls) {
  const existing = await tx.all(
    'SELECT * FROM linear_import_files WHERE workspace_id=? AND import_id=? ORDER BY id',
    [actor.workspace_id, run.id],
  );
  const hashes = new Set(existing.map((file) => file.source_hash)),
    fresh = [];
  for (const source of urls) {
    const url = new URL(source);
    assert(
      url.origin === 'https://uploads.linear.app' && !url.username && !url.password,
      422,
      'UNSAFE_SOURCE_FILE',
      'Unexpected private file origin',
    );
    const hash = sha256(source);
    if (!hashes.has(hash))
      fresh.push([
        targetId(actor.workspace_id, run.source_workspace_id, 'file:' + run.id, hash),
        actor.workspace_id,
        run.id,
        source,
        hash,
      ]);
  }
  for (let i = 0; i < fresh.length; i += 100) {
    const batch = fresh.slice(i, i + 100);
    await tx.exec(
      `INSERT INTO linear_import_files(id,workspace_id,import_id,source_url,source_hash) VALUES ${batch.map(() => '(?,?,?,?,?)').join(',')}`,
      batch.flat(),
    );
  }
  return tx.all(
    'SELECT * FROM linear_import_files WHERE workspace_id=? AND import_id=? ORDER BY id',
    [actor.workspace_id, run.id],
  );
}
export const fileStamp = (files) =>
  digest(
    files.map((file) => ({
      id: file.id,
      source_hash: file.source_hash,
      status: file.status,
      sha256: file.sha256,
      bytes: file.bytes,
      source_status: file.source_status,
    })),
  );
async function entry(tx, actor, runId, fileId, scope = 'admin') {
  requirePermission(actor, scope);
  const file = await tx.one(
    'SELECT f.*,r.status AS import_status FROM linear_import_files f JOIN linear_imports r ON r.id=f.import_id AND r.workspace_id=f.workspace_id WHERE f.workspace_id=? AND f.import_id=? AND f.id=?',
    [actor.workspace_id, runId, fileId],
  );
  if (!file) throw missing('Imported file');
  return file;
}
// `maxBytes` lets the offline restore keep large originals (e.g. video) that the HTTP upload ceiling refuses.
export async function uploadImportFile(
  db,
  storage,
  actor,
  runId,
  fileId,
  bytes,
  metadata,
  { maxBytes = MAX_UPLOAD } = {},
) {
  const expected = await db.transaction((tx) => entry(tx, actor, runId, fileId), {
    readOnly: true,
  });
  const checksum = sha256(bytes);
  assert(
    bytes.length > 0 && bytes.length <= maxBytes && checksum === metadata.sha256,
    422,
    'INVALID_IMPORTED_BYTES',
    'File size or checksum does not match',
  );
  if (expected.status === 'ready') {
    assert(
      expected.sha256 === checksum && Number(expected.bytes) === bytes.length,
      409,
      'IMPORTED_FILE_CONFLICT',
      'Different content is already retained for this source file',
    );
    return { id: expected.id, status: 'ready', sha256: checksum, unchanged: true };
  }
  assert(
    expected.status === 'pending',
    409,
    'IMPORTED_FILE_FROZEN',
    'This source file was marked unavailable',
  );
  const filename = String(metadata.filename ?? 'source-file.bin')
    .replaceAll('/', '_')
    .replaceAll('\\', '_')
    .replaceAll('\r', '')
    .replaceAll('\n', '')
    .slice(0, 180);
  const mime = String(metadata.mime ?? 'application/octet-stream')
    .slice(0, 120)
    .split(';')[0]
    .trim();
  assert(/^[\w.+-]+\/[\w.+-]+$/.test(mime), 422, 'INVALID_MEDIA_TYPE', 'Invalid source media type');
  const objectKey = actor.workspace_id + '/linear-import-content/' + checksum;
  await storage.put(objectKey, bytes, 'application/octet-stream');
  // Readback must return bytes. Do not fetch an arbitrary redirect URL here.
  const downloaded = await storage.download(objectKey, 'application/octet-stream', filename);
  const restored = downloaded.bytes;
  assert(
    restored && restored.length === bytes.length && sha256(restored) === checksum,
    502,
    'IMPORTED_READBACK_MISMATCH',
    'Private object checksum could not be verified',
  );
  return db.transaction(async (tx) => {
    await entry(tx, actor, runId, fileId);
    const updated = await tx.exec(
      "UPDATE linear_import_files SET status='ready',sha256=?,bytes=?,mime=?,filename=?,object_key=?,verified_at=? WHERE workspace_id=? AND import_id=? AND id=? AND status='pending'",
      [checksum, bytes.length, mime, filename, objectKey, now(), actor.workspace_id, runId, fileId],
    );
    assert(
      Number(updated.changes) === 1,
      409,
      'FILE_STATE_CHANGED',
      'File state changed; retry to reconcile the result',
    );
    return { id: fileId, status: 'ready', sha256: checksum, unchanged: false };
  });
}
export async function markUnavailable(tx, actor, runId, fileId, status) {
  const file = await entry(tx, actor, runId, fileId);
  assert(
    [404, 410].includes(status),
    422,
    'INVALID_SOURCE_STATUS',
    'Only explicit source not-found or gone responses may be recorded',
  );
  if (file.status === 'source_unavailable' && file.source_status === status)
    return { id: fileId, status: file.status, unchanged: true };
  assert(
    file.status === 'pending',
    409,
    'FILE_STATE_CHANGED',
    'Verified file content cannot be discarded',
  );
  const updated = await tx.exec(
    "UPDATE linear_import_files SET status='source_unavailable',source_status=?,verified_at=? WHERE workspace_id=? AND import_id=? AND id=? AND status='pending'",
    [status, now(), actor.workspace_id, runId, fileId],
  );
  assert(Number(updated.changes) === 1, 409, 'FILE_STATE_CHANGED', 'File state changed');
  return { id: fileId, status: 'source_unavailable', source_status: status };
}
export async function getImportedFile(tx, actor, fileId) {
  requirePermission(actor, 'read');
  const file = await tx.one(
    "SELECT f.* FROM linear_import_files f JOIN linear_imports r ON r.id=f.import_id AND r.workspace_id=f.workspace_id WHERE f.workspace_id=? AND f.id=? AND r.status='completed'",
    [actor.workspace_id, fileId],
  );
  if (!file) throw missing('Imported file');
  assert(
    file.status === 'ready',
    410,
    'SOURCE_FILE_UNAVAILABLE',
    'The original file was unavailable from Linear; its source link and import record were preserved',
  );
  return file;
}
