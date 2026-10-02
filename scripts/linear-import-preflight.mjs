import { parseArgs } from 'node:util';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { assessLinearReadiness } from '../packages/imports/linear-readiness.mjs';
const { values } = parseArgs({
  options: {
    snapshot: { type: 'string' },
    openapi: { type: 'string', default: 'docs/openapi.json' },
  },
  strict: true,
});
if (!values.snapshot)
  throw new Error(
    'Use --snapshot PRIVATE_EXPORT_DIRECTORY [--openapi TARGET_SCHEMA_FILE]. No write/apply mode exists.',
  );
const root = await realpath(values.snapshot);
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
if (
  manifest.format !== 'tickets-linear-snapshot-v1' ||
  !manifest.sha256 ||
  typeof manifest.sha256 !== 'object'
)
  throw new Error('Unsupported or missing snapshot manifest');
let bytes = 0,
  files = 0;
for (const [name, hash] of Object.entries(manifest.sha256)) {
  if (!/^[a-zA-Z][a-zA-Z0-9-]*\.json$/.test(name) || !/^[a-f0-9]{64}$/.test(String(hash)))
    throw new Error('Unsafe snapshot file entry');
  const path = await realpath(resolve(root, name));
  if (!path.startsWith(root + sep)) throw new Error('Snapshot file escapes its directory');
  const info = await stat(path);
  bytes += info.size;
  if (!info.isFile() || info.size > 100 * 1024 * 1024 || bytes > 256 * 1024 * 1024)
    throw new Error('Snapshot exceeds verification budget');
  const content = await readFile(path);
  if (createHash('sha256').update(content).digest('hex') !== hash)
    throw new Error('Snapshot checksum mismatch: ' + name);
  const nodes = JSON.parse(content.toString('utf8'));
  if (
    !Array.isArray(nodes) ||
    new Set(nodes.map((item) => item?.id)).size !== nodes.length ||
    nodes.some((item) => typeof item?.id !== 'string')
  )
    throw new Error('Invalid or duplicate source IDs: ' + name);
  const collection = name.slice(0, -5);
  if (manifest.counts?.[collection] !== nodes.length)
    throw new Error('Snapshot count mismatch: ' + name);
  files++;
}
const contract = JSON.parse(await readFile(values.openapi, 'utf8'));
const report = assessLinearReadiness(manifest, contract);
console.log(
  JSON.stringify(
    {
      ...report,
      snapshotFilesVerified: files,
      snapshotBytesVerified: bytes,
      contractSource: values.openapi,
    },
    null,
    2,
  ),
);
process.exitCode = report.safeToApply ? 0 : 2;
