import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
test('linking an issue assigned to an imported person does not notify that attribution ID as an account', async () => {
  const f = await fixture();
  try {
    const sourcePerson = '00000000-0000-4000-8000-000000000024';
    await f.db.transaction((tx) =>
      tx.exec(
        "INSERT INTO source_people(id,workspace_id,provider,source_id,name) VALUES(?,?,'linear','fixture-external-person','Imported teammate')",
        [sourcePerson, f.init.workspace_id],
      ),
    );
    const source = (
      await f.create({ title: 'Source with imported assignee', assignee_id: sourcePerson })
    ).data;
    const target = (await f.create({ title: 'Link target' })).data;
    const response = await f.request('POST', '/api/v1/issues/' + source.id + '/relations', {
      type: 'related',
      target_id: target.id,
    });
    expect(response.status).toBe(201);
    const comment = await f.request('POST', '/api/v1/issues/' + source.id + '/comments', {
      body: 'A real comment on an externally assigned issue',
    });
    expect(comment.status).toBe(201);
    expect((await f.db.transaction((tx) => tx.one('SELECT COUNT(*) AS n FROM relations'))).n).toBe(
      1,
    );
    expect(
      (
        await f.db.transaction((tx) =>
          tx.one('SELECT COUNT(*) AS n FROM notifications WHERE user_id=?', [sourcePerson]),
        )
      ).n,
    ).toBe(0);
    expect(
      (await f.db.transaction((tx) => tx.one('SELECT COUNT(*) AS n FROM memberships'))).n,
    ).toBe(1);
  } finally {
    await f.close();
  }
});
