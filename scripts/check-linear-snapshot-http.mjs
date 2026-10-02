import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixture } from '../tests/unit/helpers.mjs';
import { loadSnapshot, collections, canonical } from '../packages/imports/linear-source.mjs';
const { values } = parseArgs({
  strict: true,
  options: { snapshot: { type: 'string' }, report: { type: 'string' } },
});
if (!values.snapshot || !values.report || process.env.DATABASE_URL || process.env.TEST_DATABASE_URL)
  throw new Error(
    'Requires a private snapshot/report and an isolated in-memory fixture; database URLs must not be configured.',
  );
const snapshot = await loadSnapshot(values.snapshot),
  files = JSON.parse(await readFile(resolve(values.snapshot, 'private-files/files.json'), 'utf8'));
const f = await fixture(),
  started = Date.now();
let requests = 0;
const timings = [];
try {
  const request = async (method, path, data, options) => {
    requests++;
    const start = performance.now();
    const result = await f.request(method, path, data, options);
    if (path.endsWith('/plan') || path.endsWith('/apply'))
      timings.push({ path: path.split('/').at(-1), milliseconds: performance.now() - start });
    if (result.status < 200 || result.status >= 300)
      throw new Error(
        method + ' ' + path + ' failed: ' + result.status + ' ' + result.data?.error?.code,
      );
    return result.data;
  };
  const run = await request('POST', '/api/v1/imports/linear', { manifest: snapshot.manifest });
  for (const collection of collections) {
    let batch = [],
      bytes = 0;
    const flush = async () => {
      if (batch.length)
        await request('POST', '/api/v1/imports/linear/' + run.id + '/records', {
          collection,
          records: batch,
        });
      batch = [];
      bytes = 0;
    };
    for (const record of snapshot.data[collection]) {
      const size = Buffer.byteLength(JSON.stringify(record), 'utf8');
      if (size > 900000)
        throw new Error('Single source record exceeds the HTTP limit: ' + collection);
      if (batch.length && (batch.length >= 100 || bytes + size > 900000)) await flush();
      batch.push(record);
      bytes += size + 1;
    }
    await flush();
    console.log('HTTP staged', collection, snapshot.data[collection].length);
  }
  let plan = await request('POST', '/api/v1/imports/linear/' + run.id + '/plan');
  let verified = 0,
    unavailable = 0;
  for (const file of plan.files) {
    const saved = files.files[file.source_hash],
      path = '/api/v1/imports/linear/' + run.id + '/files/' + file.id;
    if (saved) {
      if (!/^[a-f0-9]{64}$/.test(saved.sha256)) throw new Error('Invalid checksum filename');
      const bytes = await readFile(resolve(values.snapshot, 'private-files', saved.sha256));
      await request('PUT', path + '/content', bytes, {
        raw: true,
        headers: {
          'content-type': saved.content_type,
          'x-file-sha256': saved.sha256,
          'x-file-name': 'source-' + file.source_hash.slice(0, 12),
        },
      });
      verified++;
    } else {
      const code = files.failures[file.source_hash]?.code;
      if (!['SOURCE_HTTP_404', 'SOURCE_HTTP_410'].includes(code))
        throw new Error('Unknown source file failure');
      await request('POST', path + '/unavailable', { source_status: Number(code.slice(-3)) });
      unavailable++;
    }
  }
  plan = await request('POST', '/api/v1/imports/linear/' + run.id + '/plan');
  const input = { plan_hash: plan.plan_hash, accept_missing_source_files: true };
  const applied = await request('POST', '/api/v1/imports/linear/' + run.id + '/apply', input);
  const replayed = await request('POST', '/api/v1/imports/linear/' + run.id + '/apply', input);
  if (canonical(applied) !== canonical(replayed)) throw new Error('HTTP replay changed the result');
  const catalog = await request('GET', '/api/v1/catalog');
  if (catalog.people.length !== 1 || catalog.source_people.length !== snapshot.data.users.length)
    throw new Error('Imported people altered access membership');
  const metadata = await f.db.transaction((tx) =>
    tx.one(
      'SELECT (SELECT count(*) FROM issues) AS issues,(SELECT count(*) FROM comments) AS comments,(SELECT count(*) FROM activity) AS history,(SELECT count(*) FROM users) AS accounts',
    ),
  );
  const report = {
    mode: 'actual HTTP request/response handlers on isolated memory database',
    productionWrites: 0,
    requests,
    timings,
    verifiedFiles: verified,
    sourceUnavailable: unavailable,
    counts: metadata,
    sourceCounts: snapshot.manifest.counts,
    replayUnchanged: true,
    elapsedMs: Date.now() - started,
  };
  await writeFile(values.report, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await f.close();
}
