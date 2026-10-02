import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { id } from '../../packages/server/core/crypto.mjs';

test('imported source assignee cannot break comments or relations', async () => {
  const f = await fixture();
  try {
    const imported = (await f.create({ title: 'Imported issue' })).data;
    const target = (await f.create({ title: 'Native target' })).data;
    const sourcePerson = id();

    await f.db.transaction(async (tx) => {
      await tx.exec(
        'INSERT INTO source_people(id,workspace_id,provider,source_id,name,email,avatar_url) VALUES(?,?,?,?,?,?,?)',
        [
          sourcePerson,
          f.init.workspace_id,
          'linear',
          'linear-user-1',
          'Historical assignee',
          'historical@example.test',
          null,
        ],
      );
      await tx.exec(
        'UPDATE issues SET assignee_id=NULL,assignee_source_id=? WHERE workspace_id=? AND id=?',
        [sourcePerson, f.init.workspace_id, imported.id],
      );
    });

    const detail = (await f.request('GET', `/api/v1/issues/${imported.id}`)).data;
    assert.equal(detail.assignee_id, sourcePerson);
    assert.equal(detail.assignee_source_id, sourcePerson);

    const comment = await f.request('POST', `/api/v1/issues/${imported.id}/comments`, {
      body: 'Continue imported work',
    });
    assert.equal(comment.status, 201);

    const relation = await f.request('POST', `/api/v1/issues/${imported.id}/relations`, {
      target_id: target.id,
      type: 'related',
    });
    assert.equal(relation.status, 201);

    const notifications = await f.db.transaction((tx) =>
      tx.all('SELECT user_id FROM notifications WHERE workspace_id=? AND issue_id=?', [
        f.init.workspace_id,
        imported.id,
      ]),
    );
    assert.deepEqual(notifications, []);
  } finally {
    await f.close();
  }
});

test('current member assignee still receives activity notifications', async () => {
  const f = await fixture();
  try {
    const member = id();
    await f.db.transaction(async (tx) => {
      await tx.exec('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)', [
        member,
        'member@example.test',
        'Member',
        'not-used-in-this-test',
        new Date().toISOString(),
      ]);
      await tx.exec('INSERT INTO memberships(workspace_id,user_id,role) VALUES(?,?,?)', [
        f.init.workspace_id,
        member,
        'member',
      ]);
    });

    const issue = (await f.create({ title: 'Assigned issue', assignee_id: member })).data;
    const before = await f.db.transaction((tx) =>
      tx.all('SELECT user_id FROM notifications WHERE workspace_id=? AND issue_id=?', [
        f.init.workspace_id,
        issue.id,
      ]),
    );
    const comment = await f.request('POST', `/api/v1/issues/${issue.id}/comments`, {
      body: 'Notify the real assignee',
    });
    assert.equal(comment.status, 201);

    const after = await f.db.transaction((tx) =>
      tx.all('SELECT user_id FROM notifications WHERE workspace_id=? AND issue_id=?', [
        f.init.workspace_id,
        issue.id,
      ]),
    );
    assert.equal(after.length, before.length + 1);
    assert(after.every((row) => row.user_id === member));
  } finally {
    await f.close();
  }
});
