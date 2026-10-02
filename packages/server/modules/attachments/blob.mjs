import { createHash } from 'node:crypto';
import { assert, missing } from '../../core/errors.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function boundedBytes(stream, limit) {
  const reader = stream.getReader(),
    parts = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        throw new Error('Stored file exceeds the upload limit');
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(parts, total);
}
export function createBlobStorage(
  env,
  { loadSDK = () => import('@vercel/blob'), maxBytes = 3145728 } = {},
) {
  assert(
    env.BLOB_READ_WRITE_TOKEN,
    503,
    'STORAGE_NOT_CONFIGURED',
    'Private Blob storage is not configured',
  );
  const options = { access: 'private', token: env.BLOB_READ_WRITE_TOKEN };
  const read = async (key) => {
    const sdk = await loadSDK();
    const result = await sdk.get(key, options);
    if (!result || result.statusCode !== 200 || !result.stream) throw missing('File');
    return boundedBytes(result.stream, maxBytes);
  };
  return {
    kind: 'blob',
    async put(key, bytes, mime) {
      const sdk = await loadSDK();
      try {
        await sdk.put(key, bytes, {
          ...options,
          contentType: mime,
          addRandomSuffix: false,
          allowOverwrite: false,
        });
      } catch (error) {
        // A previous upload can have reached storage before the SQL response was lost.
        // Only identical content can complete that retry; never overwrite the object.
        let existing;
        try {
          existing = await read(key);
        } catch {
          throw error;
        }
        assert(
          hash(existing) === hash(bytes),
          409,
          'OBJECT_EXISTS',
          'A different file already occupies this object key',
        );
      }
    },
    async download(key) {
      return { bytes: await read(key) };
    },
  };
}
