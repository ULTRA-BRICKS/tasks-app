import { test, expect } from 'bun:test';
import { numberingSetup as setup } from './linear-numbering-fixture.mjs';
import { planReferenceEdits } from '../../packages/server/modules/linear-numbering/references.mjs';
test('reference graph uses target UUIDs and origin, never substitutes cascading or ambiguous bare codes', () => {
  const mappings = [
    { id: 'a', sourceId: 'sa', oldCode: 'HYP-10', newCode: 'HYP-11' },
    { id: 'b', sourceId: 'sb', oldCode: 'HYP-11', newCode: 'HYP-10' },
  ];
  const p = planReferenceEdits('[HYP-10](/issues/a) and HYP-11; `HYP-10`', {
    mappings,
    origin: 'tasks',
  });
  expect(p.text).toBe('[HYP-11](/issues/a) and HYP-11; `HYP-10`');
  expect(p.edits).toHaveLength(1);
  expect(p.ambiguous).toHaveLength(2);
  const unknown = planReferenceEdits('HYP-10', { mappings, origin: 'mixed' });
  expect(unknown.text).toBe('HYP-10');
  expect(unknown.ambiguous).toHaveLength(1);
  expect(planReferenceEdits('HYP-10', { mappings, origin: 'linear' }).text).toBe('HYP-10');
  expect(
    planReferenceEdits('[HYP-10](https://linear.app/glide/issue/HYP-10/real)', {
      mappings,
      origin: 'tasks',
    }).text,
  ).toContain('[HYP-10]');
});
test('numbering preview performs no writes; occupied codes swap atomically with UUIDs and history preserved', async () => {
  const { f, source, rows, ids, input } = await setup();
  try {
    await f.db.transaction(async (tx) => {
      await tx.exec('UPDATE issues SET key=?,number=? WHERE id=?', ['TMP-99', 99, ids[0]]);
      await tx.exec('UPDATE issues SET key=?,number=? WHERE id=?', [
        rows[0].code,
        Number(rows[0].code.split('-').at(-1)),
        ids[1],
      ]);
      await tx.exec('UPDATE issues SET key=?,number=? WHERE id=?', [
        rows[1].code,
        Number(rows[1].code.split('-').at(-1)),
        ids[0],
      ]);
    });
    const before = await f.db.transaction((tx) =>
      tx.all('SELECT id,title,description,key,version FROM issues ORDER BY id'),
    );
    const history = await f.db.transaction((tx) =>
      tx.all('SELECT id,action,data FROM activity ORDER BY id'),
    );
    const p = await f.request('POST', '/api/v1/sync/linear/numbering', input);
    expect(p.status).toBe(200);
    expect(p.data.applied).toBe(false);
    expect(p.data.changes).toHaveLength(2);
    expect(
      await f.db.transaction((tx) =>
        tx.all('SELECT id,title,description,key,version FROM issues ORDER BY id'),
      ),
    ).toEqual(before);
    const result = await f.request('POST', '/api/v1/sync/linear/numbering', {
      ...input,
      plan_hash: p.data.plan_hash,
    });
    expect(result.status).toBe(200);
    expect(result.data.applied).toBe(true);
    for (let i = 0; i < ids.length; i++) {
      const issue = (await f.request('GET', '/api/v1/issues/' + ids[i])).data;
      expect(issue.key).toBe(rows[i].code);
      expect(issue.title).toBe(source.data.issues[i].title);
    }
    expect(
      await f.db.transaction((tx) => tx.all('SELECT id,action,data FROM activity ORDER BY id')),
    ).toEqual(history);
    expect(
      (
        await f.request('POST', '/api/v1/sync/linear/numbering', {
          ...input,
          plan_hash: p.data.plan_hash,
        })
      ).data.unchanged,
    ).toBe(true);
    expect((await f.request('GET', '/api/v1/sync/linear/numbering/graph')).status).toBe(200);
  } finally {
    await f.close();
  }
});
test('missing mapping, duplicate final codes, stale plan and unprivileged requests cannot renumber', async () => {
  const { f, input, ids } = await setup();
  try {
    expect(
      (await f.request('POST', '/api/v1/sync/linear/numbering', input, { anonymous: true })).status,
    ).toBe(401);
    expect(
      (
        await f.request('POST', '/api/v1/sync/linear/numbering', {
          ...input,
          records: input.records.slice(1),
        })
      ).status,
    ).toBe(409);
    const p = (await f.request('POST', '/api/v1/sync/linear/numbering', input)).data;
    const issue = (await f.request('GET', '/api/v1/issues/' + ids[0])).data;
    await f.request('PATCH', '/api/v1/issues/' + ids[0], {
      version: issue.version,
      title: 'Changed during preview',
    });
    expect(
      (
        await f.request('POST', '/api/v1/sync/linear/numbering', {
          ...input,
          plan_hash: p.plan_hash,
        })
      ).status,
    ).toBe(409);
    const duplicate = input.records.map((r) => ({ ...r, code: input.records[0].code }));
    expect(
      (await f.request('POST', '/api/v1/sync/linear/numbering', { ...input, records: duplicate }))
        .status,
    ).toBe(422);
    await f.db.transaction((tx) =>
      tx.exec("UPDATE memberships SET role='member' WHERE workspace_id=? AND user_id=?", [
        f.init.workspace_id,
        f.init.user_id,
      ]),
    );
    expect((await f.request('GET', '/api/v1/sync/linear/numbering/graph')).status).toBe(403);
  } finally {
    await f.close();
  }
});

test('explicit evidence can resolve a code occurrence, while unresolved ambiguities block cutover', async () => {
  const mappings = [
    { id: 'a', sourceId: 'sa', oldCode: 'HYP-10', newCode: 'HYP-11' },
    { id: 'b', sourceId: 'sb', oldCode: 'HYP-11', newCode: 'HYP-10' },
  ];
  const literal = planReferenceEdits('`HYP-10`', {
    mappings,
    origin: 'tasks',
    decisions: {
      1: { target_id: null, evidence: 'A literal fixture value, not a task reference' },
    },
  });
  expect(literal.text).toBe('`HYP-10`');
  expect(literal.ambiguous).toHaveLength(0);
  const resolved = planReferenceEdits('HYP-10', {
    mappings,
    origin: 'mixed',
    decisions: {
      0: { target_id: 'a', evidence: 'Native UUID link in the original document revision' },
    },
  });
  expect(resolved.text).toBe('HYP-11');
  expect(resolved.edits[0].reason).toBe('explicit-identity-decision');
  const { f, input, ids } = await setup();
  try {
    await f.db.transaction(async (tx) => {
      await tx.exec('UPDATE issues SET key=?,number=?,description=? WHERE id=?', [
        'SRC-999',
        999,
        'Ambiguous `SRC-999` example',
        ids[0],
      ]);
    });
    const preview = await f.request('POST', '/api/v1/sync/linear/numbering', input);
    expect(preview.data.ambiguousReferences.length).toBeGreaterThan(0);
    const refused = await f.request('POST', '/api/v1/sync/linear/numbering', {
      ...input,
      plan_hash: preview.data.plan_hash,
    });
    expect(refused.status).toBe(409);
    expect((await f.request('GET', '/api/v1/issues/' + ids[0])).data.key).toBe('SRC-999');
  } finally {
    await f.close();
  }
});

test('legacy native URLs are rewritten to the same task UUID, not to a newly occupied code', () => {
  const mappings = [
    { id: 'a', sourceId: 'sa', oldCode: 'HYP-10', newCode: 'HYP-11' },
    { id: 'b', sourceId: 'sb', oldCode: 'HYP-11', newCode: 'HYP-10' },
  ];
  const p = planReferenceEdits('[HYP-10](https://tasks-ultrabricks.vercel.app/issues/HYP-10)', {
    mappings,
    origin: 'mixed',
  });
  expect(p.text).toBe('[HYP-11](https://tasks-ultrabricks.vercel.app/issues/a)');
  expect(p.ambiguous).toHaveLength(0);
  expect(new Set(p.edits.map((e) => e.targetId))).toEqual(new Set(['a']));
});

test('unknown-domain code URLs are unresolved references rather than silently redirected after cutover', () => {
  const mappings = [
    { id: 'a', sourceId: 'sa', oldCode: 'HYP-10', newCode: 'HYP-11' },
    { id: 'b', sourceId: 'sb', oldCode: 'HYP-11', newCode: 'HYP-10' },
  ];
  const text = '[open task](https://other-deployment.example/issues/HYP-10)';
  const planned = planReferenceEdits(text, { mappings, origin: 'tasks' });
  expect(planned.text).toBe(text);
  expect(planned.ambiguous).toHaveLength(1);
  expect(planned.ambiguous[0].reason).toBe('unverified-code-url');
  const sourceLink = planReferenceEdits('[open task](https://linear.app/glide/issue/HYP-10/name)', {
    mappings,
    origin: 'tasks',
  });
  expect(sourceLink.ambiguous).toHaveLength(0);
});

test('authorship in Tasks alone does not prove which colliding bare code was intended', () => {
  const mappings = [
    { id: 'a', sourceId: 'sa', oldCode: 'HYP-10', newCode: 'HYP-11' },
    { id: 'b', sourceId: 'sb', oldCode: 'HYP-11', newCode: 'HYP-10' },
  ];
  const result = planReferenceEdits('Review HYP-10', { mappings, origin: 'tasks' });
  expect(result.text).toBe('Review HYP-10');
  expect(result.ambiguous).toHaveLength(1);
});
test('an explicit decision cannot create overlapping key-to-UUID URL edits', () => {
  const mappings = [
    { id: 'a', sourceId: 'sa', oldCode: 'HYP-10', newCode: 'HYP-11' },
    { id: 'b', sourceId: 'sb', oldCode: 'HYP-11', newCode: 'HYP-10' },
  ];
  const text = '[HYP-10](/issues/HYP-10)';
  const result = planReferenceEdits(text, {
    mappings,
    origin: 'tasks',
    decisions: {
      [text.lastIndexOf('HYP-10')]: {
        target_id: 'a',
        evidence: 'The native URL resolves to unchanged task a.',
      },
    },
  });
  expect(result.text).toBe('[HYP-11](/issues/a)');
  expect(result.ambiguous).toHaveLength(0);
});

test('a real HTTP reference rewrite can be previewed, committed and replayed with a JSON-safe receipt', async () => {
  const { f, ids, rows, input } = await setup();
  try {
    await f.db.transaction((tx) =>
      tx.exec('UPDATE issues SET key=?,number=? WHERE workspace_id=? AND id=?', [
        'SRC-999',
        999,
        f.init.workspace_id,
        ids[0],
      ]),
    );
    const before = 'Follow [SRC-999](/issues/' + ids[0] + ')';
    const comment = (
      await f.request('POST', '/api/v1/issues/' + ids[0] + '/comments', { body: before })
    ).data;
    const preview = await f.request('POST', '/api/v1/sync/linear/numbering', input);
    expect(preview.status).toBe(200);
    expect(preview.data.referenceChanges.length).toBeGreaterThan(0);
    const apply = await f.request('POST', '/api/v1/sync/linear/numbering', {
      ...input,
      plan_hash: preview.data.plan_hash,
    });
    expect(apply.status).toBe(200);
    expect(apply.data.applied).toBe(true);
    const current = (await f.request('GET', '/api/v1/issues/' + ids[0])).data;
    expect(current.comments.find((c) => c.id === comment.id).body).toBe(
      'Follow [' + rows[0].code + '](/issues/' + ids[0] + ')',
    );
    const receipt = await f.db.transaction((tx) =>
      tx.one('SELECT payload FROM outbox WHERE workspace_id=? AND id=?', [
        f.init.workspace_id,
        apply.data.id,
      ]),
    );
    expect(JSON.parse(receipt.payload).edits[0].before).toBe(before);
    expect(
      (
        await f.request('POST', '/api/v1/sync/linear/numbering', {
          ...input,
          plan_hash: preview.data.plan_hash,
        })
      ).data.unchanged,
    ).toBe(true);
  } finally {
    await f.close();
  }
});
