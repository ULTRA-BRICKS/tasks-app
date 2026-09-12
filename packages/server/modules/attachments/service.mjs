import { createBlobStorage } from './blob.mjs';
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { id, now } from '../../core/crypto.mjs';
import { assert, missing, requirePermission } from '../../core/errors.mjs';
import { assertModule } from '../../core/modules.mjs';
import { getIssue, recordActivity } from '../tickets/service.mjs';

export const MAX_UPLOAD = 3 * 1024 * 1024; // Below Vercel's request ceiling, including transport overhead.
const safeTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/zip',
]);
export function inspectFile(bytes, mime) {
  assert(
    safeTypes.has(mime),
    415,
    'UNSUPPORTED_MEDIA',
    'Supported: PNG, JPEG, WebP, PDF, plain text, Markdown, ZIP. SVG/HTML are not accepted.',
  );
  const b = Buffer.from(bytes);
  const ok =
    mime === 'image/png'
      ? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mime === 'image/jpeg'
        ? b[0] === 255 && b[1] === 216 && b[2] === 255
        : mime === 'image/webp'
          ? b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'
          : mime === 'application/pdf'
            ? b.subarray(0, 5).toString() === '%PDF-'
            : mime === 'application/zip'
              ? b[0] === 0x50 && b[1] === 0x4b && [3, 5, 7].includes(b[2])
              : !b.subarray(0, 8192).includes(0);
  assert(ok, 415, 'MEDIA_MISMATCH', 'File contents do not match the declared type');
}
function filename(value) {
  // oxlint-disable-next-line no-control-regex -- Intentionally remove untrusted terminal/path control characters.
  return value.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 180);
}
export function createStorage(env = process.env, { loadBlobSDK } = {}) {
  if (env.STORAGE_DRIVER === 'blob')
    return createBlobStorage(env, {
      maxBytes: MAX_UPLOAD,
      ...(loadBlobSDK ? { loadSDK: loadBlobSDK } : {}),
    });
  if (env.STORAGE_DRIVER === 's3') {
    let promise;
    const client = () =>
      (promise ??= (async () => {
        assert(
          env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY,
          503,
          'STORAGE_NOT_CONFIGURED',
          'Object storage is not configured',
        );
        const sdk = await import('@aws-sdk/client-s3');
        return {
          sdk,
          client: new sdk.S3Client({
            endpoint: env.S3_ENDPOINT,
            region: env.S3_REGION || 'auto',
            forcePathStyle: true,
            credentials: {
              accessKeyId: env.S3_ACCESS_KEY_ID,
              secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            },
          }),
        };
      })());
    return {
      kind: 's3',
      async put(key, bytes, mime) {
        const c = await client();
        await c.client.send(
          new c.sdk.PutObjectCommand({
            Bucket: env.S3_BUCKET,
            Key: key,
            Body: bytes,
            ContentLength: bytes.length,
            ContentType: mime,
          }),
        );
      },
      async download(key, mime, name) {
        const c = await client();
        const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
        const url = await getSignedUrl(
          c.client,
          new c.sdk.GetObjectCommand({
            Bucket: env.S3_BUCKET,
            Key: key,
            ResponseContentType: mime,
            ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
          }),
          { expiresIn: 60 },
        );
        return { url };
      },
    };
  }
  assert(
    env.NODE_ENV !== 'production' && !env.VERCEL,
    503,
    'STORAGE_NOT_CONFIGURED',
    'Production requires private object storage. Local disk is not durable on Vercel.',
  );
  const root = resolve(env.UPLOAD_DIR || '.data/uploads');
  function location(key) {
    const file = resolve(root, key);
    assert(file.startsWith(root + '/'), 400, 'INVALID_KEY', 'Invalid object key');
    return file;
  }
  return {
    kind: 'local',
    async put(key, bytes) {
      const path = location(key);
      await mkdir(dirname(path), { recursive: true });
      const temp = path + '.' + id() + '.tmp';
      await writeFile(temp, bytes, { mode: 0o600 });
      await rename(temp, path);
    },
    async download(key) {
      try {
        return { bytes: await readFile(location(key)) };
      } catch (e) {
        if (e.code === 'ENOENT') throw missing('File');
        throw e;
      }
    },
  };
}
export async function reserveAttachment(tx, actor, key, input, env) {
  requirePermission(actor, 'write');
  await assertModule(tx, actor.workspace_id, 'attachments');
  const issue = await getIssue(tx, actor, key);
  const max = Math.min(Number(env.MAX_UPLOAD_BYTES) || MAX_UPLOAD, MAX_UPLOAD);
  assert(input.bytes <= max, 413, 'FILE_TOO_LARGE', `File limit is ${max} bytes`);
  assert(safeTypes.has(input.mime), 415, 'UNSUPPORTED_MEDIA', 'Unsupported file type');
  const total = await tx.one(
    "SELECT COALESCE(SUM(bytes),0) AS bytes FROM attachments WHERE workspace_id=? AND status IN ('pending','ready')",
    [actor.workspace_id],
  );
  assert(
    Number(total.bytes) + input.bytes <= (Number(env.WORKSPACE_STORAGE_BYTES) || 524288000),
    413,
    'STORAGE_QUOTA',
    'Workspace attachment quota exceeded',
  );
  const record = {
    id: id(),
    workspace_id: actor.workspace_id,
    issue_id: issue.id,
    owner_id: actor.id,
    object_key: actor.workspace_id + '/' + id(),
    filename: filename(input.filename),
    mime: input.mime,
    bytes: input.bytes,
    status: 'pending',
    created_at: now(),
  };
  await tx.exec(
    `INSERT INTO attachments(${Object.keys(record).join(',')}) VALUES(${Object.keys(record)
      .map(() => '?')
      .join(',')})`,
    Object.values(record),
  );
  return {
    id: record.id,
    upload_url: `/api/v1/attachments/${record.id}/content`,
    method: 'PUT',
    max_bytes: max,
  };
}
export async function uploadAttachment(tx, actor, attachmentId, bytes, storage) {
  requirePermission(actor, 'write');
  await assertModule(tx, actor.workspace_id, 'attachments');
  const record = await tx.one('SELECT * FROM attachments WHERE workspace_id=? AND id=?', [
    actor.workspace_id,
    attachmentId,
  ]);
  if (!record) throw missing('Attachment');
  assert(
    record.owner_id === actor.id,
    403,
    'FORBIDDEN',
    'Only the uploader can complete this upload',
  );
  assert(record.status === 'pending', 409, 'UPLOAD_COMPLETE', 'Upload cannot be overwritten');
  assert(
    new Date(record.created_at).getTime() > Date.now() - 3600000,
    410,
    'UPLOAD_EXPIRED',
    'Upload expired',
  );
  assert(
    bytes.length === record.bytes && bytes.length <= MAX_UPLOAD,
    422,
    'SIZE_MISMATCH',
    'File size does not match the reservation',
  );
  inspectFile(bytes, record.mime);
  const issue = await getIssue(tx, actor, record.issue_id);
  // Workspace lock ensures this key is written exactly once by this application.
  await storage.put(record.object_key, bytes, record.mime);
  await tx.exec("UPDATE attachments SET status='ready' WHERE id=? AND workspace_id=?", [
    record.id,
    actor.workspace_id,
  ]);
  await recordActivity(tx, actor, issue, 'attached', { filename: record.filename });
  return { id: record.id, filename: record.filename, mime: record.mime, bytes: record.bytes };
}
export async function authorizeDownload(tx, actor, attachmentId) {
  requirePermission(actor, 'read');
  await assertModule(tx, actor.workspace_id, 'attachments');
  const record = await tx.one(
    "SELECT * FROM attachments WHERE workspace_id=? AND id=? AND status='ready'",
    [actor.workspace_id, attachmentId],
  );
  if (!record) throw missing('Attachment');
  await getIssue(tx, actor, record.issue_id);
  return { object_key: record.object_key, mime: record.mime, filename: record.filename };
}
// Network transfers must not hold a transaction/pooled DB connection.
export async function downloadAttachment(record, storage) {
  return {
    ...(await storage.download(record.object_key, record.mime, record.filename)),
    mime: record.mime,
    filename: record.filename,
  };
}
