import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Pin a real Git object, never a moving branch. This script is maintenance-only;
// normal builds and contract tests read the checked-in source without networking.
const sha = '8d1e734c98f5531560b2e608d298d67d217722ee';
const source = `https://api.github.com/repos/linear/linear/git/blobs/${sha}`;
const response = await fetch(source, {
  headers: {
    accept: 'application/vnd.github+json',
    ...(process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
  },
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw new Error(`Cannot fetch pinned Linear schema: HTTP ${response.status}`);
const blob = await response.json();
if (blob.encoding !== 'base64') throw new Error('Unexpected GitHub blob encoding');
const bytes = Buffer.from(blob.content, 'base64');
const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
if (actual !== sha) throw new Error('Pinned Linear schema integrity check failed');
await mkdir('vendor/linear', { recursive: true });
await writeFile('vendor/linear/schema.graphql', bytes);
await writeFile('vendor/linear/provenance.json', JSON.stringify({
  repository: 'https://github.com/linear/linear',
  path: 'packages/sdk/src/schema.graphql',
  gitBlobSha: sha,
  retrievedAt: '2026-09-10',
  license: 'MIT',
}, null, 2) + '\n');
const license = await fetch('https://raw.githubusercontent.com/linear/linear/master/LICENSE', { signal: AbortSignal.timeout(30000) });
if (!license.ok) throw new Error(`Cannot fetch upstream license: HTTP ${license.status}`);
await writeFile('vendor/linear/LICENSE', await license.text());
console.log(`Pinned official Linear GraphQL schema: ${sha} (${bytes.length} bytes)`);
