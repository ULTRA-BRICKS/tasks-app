import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadSnapshot } from '../packages/imports/linear-source.mjs';
import { projectSnapshot } from '../packages/imports/linear-projection.mjs';
const { values } = parseArgs({
  strict: true,
  options: { snapshot: { type: 'string' }, limit: { type: 'string' } },
});
if (!values.snapshot) throw new Error('Use --snapshot PRIVATE_SOURCE_DIRECTORY');
const snapshot = await loadSnapshot(values.snapshot);
const projection = projectSnapshot(snapshot, {
  workspace_id: '00000000-0000-4000-8000-000000000001',
  id: '00000000-0000-4000-8000-000000000002',
});
const directory = resolve(values.snapshot, 'private-files');
await mkdir(directory, { recursive: true, mode: 0o700 });
const manifestPath = resolve(directory, 'files.json');
let manifest = { format: 1, files: {}, failures: {} };
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch {}
// The normal CLI owns authentication; credential bytes stay in memory and are never logged.
const login = spawnSync('linear', ['auth', 'token'], { encoding: 'utf8', timeout: 15000 });
if (login.status !== 0) throw new Error('The authenticated Linear CLI is unavailable');
const token = login.stdout.trim();
if (!token || /\s/.test(token))
  throw new Error('Unexpected credential format; nothing was downloaded');
const urls = projection.privateAssets.slice(0, values.limit ? Number(values.limit) : undefined);
if (!Number.isSafeInteger(urls.length)) throw new Error('Invalid limit');
let totalBytes = Object.values(manifest.files).reduce((n, file) => n + file.bytes, 0),
  completed = 0;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const sourceUrl of urls) {
  const url = new URL(sourceUrl),
    identity = hash(sourceUrl);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'uploads.linear.app' ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error('Unexpected private file origin');
  const previous = manifest.files[identity];
  if (previous) {
    try {
      const bytes = await readFile(resolve(directory, previous.sha256));
      if (hash(bytes) === previous.sha256 && bytes.length === previous.bytes) {
        completed++;
        continue;
      }
    } catch {}
  }
  try {
    const response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: { Authorization: token.startsWith('lin_api_') ? token : 'Bearer ' + token },
    });
    if (!response.ok)
      throw Object.assign(new Error('SOURCE_HTTP_' + response.status), {
        code: 'SOURCE_HTTP_' + response.status,
      });
    const parts = [];
    let size = 0;
    for await (const part of response.body) {
      size += part.length;
      if (size > 100 * 1024 * 1024 || totalBytes + size > 512 * 1024 * 1024)
        throw new Error('SOURCE_FILE_BUDGET');
      parts.push(part);
    }
    if (!size) throw new Error('EMPTY_SOURCE_FILE');
    const bytes = Buffer.concat(parts),
      checksum = hash(bytes);
    await writeFile(resolve(directory, checksum), bytes, { mode: 0o600 });
    totalBytes += size;
    manifest.files[identity] = {
      source_url: sourceUrl,
      sha256: checksum,
      bytes: size,
      content_type: response.headers.get('content-type') ?? 'application/octet-stream',
      downloaded_at: new Date().toISOString(),
    };
    delete manifest.failures[identity];
    completed++;
  } catch (error) {
    manifest.failures[identity] = {
      code: /^SOURCE_HTTP_\d+$/.test(error.code ?? '') ? error.code : 'DOWNLOAD_FAILED',
      checked_at: new Date().toISOString(),
    };
  }
  await writeFile(manifestPath + '.tmp', JSON.stringify(manifest, null, 2), { mode: 0o600 });
  await rename(manifestPath + '.tmp', manifestPath);
  if ((completed + Object.keys(manifest.failures).length) % 20 === 0)
    console.log(
      'Checked',
      completed,
      'downloaded/verified;',
      Object.keys(manifest.failures).length,
      'failures',
    );
}
console.log(
  JSON.stringify({
    required: projection.privateAssets.length,
    selected: urls.length,
    verified: completed,
    failures: Object.keys(manifest.failures).length,
    totalBytes,
    credentialsPrinted: false,
    destination: 'private local snapshot, no public upload',
  }),
);
process.exitCode = Object.keys(manifest.failures).length ? 1 : 0;
