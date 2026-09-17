import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
export const collections = Object.freeze([
  'teams',
  'users',
  'workflowStates',
  'issueLabels',
  'projectStatuses',
  'projects',
  'projectMilestones',
  'cycles',
  'initiatives',
  'issues',
  'comments',
  'documents',
  'attachments',
  'issueRelations',
  'projectRelations',
  'initiativeRelations',
  'projectUpdates',
  'initiativeUpdates',
  'teamMembers',
  'issueHistory',
]);
export const uuid = (value) =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
        .join(',') +
      '}'
    );
  const result = JSON.stringify(value);
  if (result === undefined || (typeof value === 'number' && !Number.isFinite(value)))
    throw new Error('Non-JSON source value');
  return result;
}
export const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex');
export function targetId(workspace, source, collection, id) {
  const hex = createHash('sha256')
    .update(canonical(['tasks-linear-v1', workspace, source, collection, id]))
    .digest('hex');
  return (
    hex.slice(0, 8) +
    '-' +
    hex.slice(8, 12) +
    '-5' +
    hex.slice(13, 16) +
    '-a' +
    hex.slice(17, 20) +
    '-' +
    hex.slice(20, 32)
  );
}
export function validateManifest(manifest) {
  if (manifest?.format !== 'tickets-linear-snapshot-v1' || !uuid(manifest.organization?.id))
    throw new Error('Invalid Linear snapshot manifest');
  if (
    !manifest.counts ||
    collections.some(
      (c) =>
        !Number.isSafeInteger(manifest.counts[c]) ||
        manifest.counts[c] < 0 ||
        manifest.counts[c] > 100000,
    )
  )
    throw new Error('Missing or invalid collection counts');
  if (Object.values(manifest.counts).reduce((n, count) => n + count, 0) > 100000)
    throw new Error('Snapshot exceeds total record budget');
  if (Object.keys(manifest.counts).some((c) => !collections.includes(c)))
    throw new Error('Unknown source collection');
  if (
    manifest.validationFindings?.length ||
    Object.values(manifest.issueVerificationDrift ?? {}).some((a) => !Array.isArray(a) || a.length)
  )
    throw new Error('Source verification is not clean');
}
export async function loadSnapshot(directory) {
  const root = await realpath(directory);
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  validateManifest(manifest);
  const data = {},
    hashes = {};
  let bytes = 0;
  for (const name of collections) {
    const file = await realpath(resolve(root, name + '.json'));
    if (!file.startsWith(root + sep)) throw new Error('Snapshot path escapes its directory');
    const info = await stat(file);
    bytes += info.size;
    if (!info.isFile() || info.size > 100 * 1024 * 1024 || bytes > 256 * 1024 * 1024)
      throw new Error('Snapshot exceeds verification budget');
    const raw = await readFile(file);
    if (createHash('sha256').update(raw).digest('hex') !== manifest.sha256?.[name + '.json'])
      throw new Error('Snapshot checksum mismatch: ' + name);
    const rows = JSON.parse(raw.toString('utf8'));
    if (
      !Array.isArray(rows) ||
      rows.length !== manifest.counts[name] ||
      rows.some((row) => !row || !uuid(row.id)) ||
      new Set(rows.map((row) => row.id)).size !== rows.length
    )
      throw new Error('Invalid source rows: ' + name);
    for (const row of rows)
      for (const value of Object.values(row)) {
        if (value && typeof value === 'object' && value.pageInfo?.hasNextPage)
          throw new Error('Unfinished nested pagination: ' + name);
      }
    data[name] = rows;
    hashes[name] = digest(rows);
  }
  return { manifest, data, bytes, normalizedHash: digest(hashes) };
}
