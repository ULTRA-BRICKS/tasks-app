import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
import { sourceFixture } from './linear-import-fixture.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';
test('linking an imported issue assigned to a source-only person does not create a fake membership notification', async () => {
  const f = await fixture(),
    source = sourceFixture();
  try {
    const run = (await f.request('POST', '/api/v1/imports/linear', { manifest: source.manifest }))
      .data.id;
    for (const [collection, records] of Object.entries(source.data))
      if (records.length)
        expect(
          (
            await f.request('POST', `/api/v1/imports/linear/${run}/records`, {
              collection,
              records,
            })
          ).status,
        ).toBe(200);
    const plan = (await f.request('POST', `/api/v1/imports/linear/${run}/plan`)).data;
    expect(
      (
        await f.request('POST', `/api/v1/imports/linear/${run}/apply`, {
          plan_hash: plan.plan_hash,
        })
      ).status,
    ).toBe(200);
    const issueId = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue),
      sourcePerson = targetId(f.init.workspace_id, source.ids.org, 'users', source.ids.user);
    await f.db.transaction((tx) =>
      tx.exec(
        'UPDATE issues SET assignee_id=NULL,assignee_source_id=? WHERE id=? AND workspace_id=?',
        [sourcePerson, issueId, f.init.workspace_id],
      ),
    );
    const other = (await f.create({ title: 'Native counterpart' })).data;
    const result = await f.request('POST', '/api/v1/issues/' + issueId + '/relations', {
      target_id: other.id,
      type: 'related',
    });
    expect(result.status).toBe(201);
    const notifications = await f.db.transaction((tx) =>
      tx.all('SELECT * FROM notifications WHERE workspace_id=? AND user_id=?', [
        f.init.workspace_id,
        sourcePerson,
      ]),
    );
    expect(notifications).toHaveLength(0);
    const detail = (await f.request('GET', '/api/v1/issues/' + issueId)).data;
    expect(detail.assignee_source_id).toBe(sourcePerson);
    const membership = await f.db.transaction((tx) =>
      tx.one('SELECT user_id FROM memberships WHERE workspace_id=? AND user_id=?', [
        f.init.workspace_id,
        sourcePerson,
      ]),
    );
    expect(membership).toBeNull();
  } finally {
    await f.close();
  }
});
