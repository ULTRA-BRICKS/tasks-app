import { expect } from 'bun:test';
import { fixture } from './helpers.mjs';
import { sourceFixture } from './linear-import-fixture.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';
/** Imports the synthetic Linear source over real HTTP so canonical numbering has reviewed mappings. */
export async function numberingSetup() {
  const f = await fixture(),
    source = sourceFixture();
  const run = (await f.request('POST', '/api/v1/imports/linear', { manifest: source.manifest }))
    .data.id;
  for (const [collection, records] of Object.entries(source.data))
    if (records.length)
      expect(
        (await f.request('POST', `/api/v1/imports/linear/${run}/records`, { collection, records }))
          .status,
      ).toBe(200);
  const plan = (await f.request('POST', `/api/v1/imports/linear/${run}/plan`)).data;
  expect(
    (await f.request('POST', `/api/v1/imports/linear/${run}/apply`, { plan_hash: plan.plan_hash }))
      .status,
  ).toBe(200);
  const rows = source.data.issues.map((r) => ({
    source_id: r.id,
    code: r.identifier,
    team_id: r.team.id,
    updated_at: r.updatedAt,
  }));
  const ids = rows.map((r) => targetId(f.init.workspace_id, source.ids.org, 'issues', r.source_id));
  // The synthetic local demo team has no source mapping; it is empty and not in the managed source teams.
  return { f, source, rows, ids, input: { source_workspace_id: source.ids.org, records: rows } };
}
/** Previews, then applies one hash-guarded canonical renumbering and returns its receipt result. */
export async function renumber(f, input) {
  const preview = await f.request('POST', '/api/v1/sync/linear/numbering', input);
  expect(preview.status).toBe(200);
  const applied = await f.request('POST', '/api/v1/sync/linear/numbering', {
    ...input,
    plan_hash: preview.data.plan_hash,
  });
  expect(applied.status).toBe(200);
  expect(applied.data.applied).toBe(true);
  return applied.data;
}
