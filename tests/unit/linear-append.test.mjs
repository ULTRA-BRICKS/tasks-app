import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
import { sourceFixture } from './linear-import-fixture.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';
async function imported() {
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
  const plan = await f.request('POST', `/api/v1/imports/linear/${run}/plan`);
  expect(
    (
      await f.request('POST', `/api/v1/imports/linear/${run}/apply`, {
        plan_hash: plan.data.plan_hash,
      })
    ).status,
  ).toBe(200);
  return { f, source };
}
function payload(source) {
  const issue = {
    ...source.data.issues.find((r) => r.id === source.ids.issue),
    id: crypto.randomUUID(),
    title: 'New source issue',
    parent: null,
  };
  const comment = {
    ...source.data.comments[0],
    id: crypto.randomUUID(),
    issueId: issue.id,
    body: 'Original source comment',
  };
  return { source_workspace_id: source.ids.org, issues: [issue], comments: [comment] };
}
test('append plan imports distinct source UUIDs, preserves authors and original timestamps, and retries safely', async () => {
  const { f, source } = await imported(),
    input = payload(source);
  try {
    const before = (await f.request('GET', '/api/v1/issues')).data.data;
    const plan = await f.request('POST', '/api/v1/imports/linear/append', input);
    expect(plan.status).toBe(200);
    expect(plan.data.applied).toBe(false);
    expect((await f.request('GET', '/api/v1/issues')).data.data).toHaveLength(before.length);
    const result = await f.request('POST', '/api/v1/imports/linear/append', {
      ...input,
      plan_hash: plan.data.plan_hash,
    });
    expect(result.status).toBe(200);
    expect(result.data.applied).toBe(true);
    expect(result.data.created.issues).toBe(1);
    expect(result.data.created.comments).toBe(1);
    const issueId = targetId(f.init.workspace_id, source.ids.org, 'issues', input.issues[0].id);
    const issue = (await f.request('GET', '/api/v1/issues/' + issueId)).data;
    expect(issue.key).not.toBe(input.issues[0].identifier);
    expect(issue.title).toBe(input.issues[0].title);
    expect(issue.created_at).toBe(input.issues[0].createdAt);
    expect(issue.creator_source_id).toBe(
      targetId(f.init.workspace_id, source.ids.org, 'users', source.ids.user),
    );
    expect(issue.comments[0].author_name).toBe('Source author');
    expect(issue.comments[0].body).toBe('Original source comment');
    expect(
      issue.links.some(
        (l) =>
          l.provider === 'linear' &&
          l.external_id === input.issues[0].id &&
          l.title === input.issues[0].identifier,
      ),
    ).toBe(true);
    const replay = await f.request('POST', '/api/v1/imports/linear/append', {
      ...input,
      plan_hash: plan.data.plan_hash,
    });
    expect(replay.status).toBe(200);
    expect(replay.data.unchanged).toBe(true);
    const counts = await f.db.transaction((tx) =>
      tx.one(
        'SELECT (SELECT COUNT(*) FROM users) AS users,(SELECT COUNT(*) FROM memberships) AS memberships',
      ),
    );
    expect(Number(counts.users)).toBe(1);
    expect(Number(counts.memberships)).toBe(1);
    for (const row of before)
      expect((await f.request('GET', '/api/v1/issues/' + row.id)).data.title).toBe(row.title);
  } finally {
    await f.close();
  }
});
test('invalid source organization, non-admin caller, and unresolved references cannot append data', async () => {
  const { f, source } = await imported(),
    input = payload(source);
  try {
    expect(
      (
        await f.request('POST', '/api/v1/imports/linear/append', {
          ...input,
          source_workspace_id: crypto.randomUUID(),
        })
      ).status,
    ).toBe(403);
    expect(
      (await f.request('POST', '/api/v1/imports/linear/append', input, { anonymous: true })).status,
    ).toBe(401);
    input.issues[0].state = { id: crypto.randomUUID() };
    expect((await f.request('POST', '/api/v1/imports/linear/append', input)).status).toBe(409);
    await f.db.transaction((tx) =>
      tx.exec('UPDATE memberships SET role=? WHERE workspace_id=? AND user_id=?', [
        'member',
        f.init.workspace_id,
        f.init.user_id,
      ]),
    );
    expect((await f.request('POST', '/api/v1/imports/linear/append', payload(source))).status).toBe(
      403,
    );
  } finally {
    await f.close();
  }
});

test('changed plan and changed previously imported source are rejected without native writes', async () => {
  const { f, source } = await imported(),
    input = payload(source);
  try {
    const plan = (await f.request('POST', '/api/v1/imports/linear/append', input)).data;
    const teamId = targetId(f.init.workspace_id, source.ids.org, 'teams', source.ids.team);
    await f.request('POST', '/api/v1/issues', { team_id: teamId, title: 'Concurrent local task' });
    expect(
      (
        await f.request('POST', '/api/v1/imports/linear/append', {
          ...input,
          plan_hash: plan.plan_hash,
        })
      ).status,
    ).toBe(409);
    const modified = {
      source_workspace_id: source.ids.org,
      issues: [{ ...source.data.issues[0], title: 'Do not overwrite' }],
      comments: [],
    };
    expect((await f.request('POST', '/api/v1/imports/linear/append', modified)).status).toBe(409);
    expect(
      (
        await f.request(
          'GET',
          '/api/v1/issues/' +
            targetId(f.init.workspace_id, source.ids.org, 'issues', input.issues[0].id),
        )
      ).status,
    ).toBe(404);
  } finally {
    await f.close();
  }
});
test('a source child and comment may arrive before their parent in a batch', async () => {
  const { f, source } = await imported(),
    input = payload(source);
  try {
    const parent = input.issues[0],
      child = {
        ...parent,
        id: crypto.randomUUID(),
        identifier: 'SRC-99',
        number: 99,
        title: 'Child',
        parent: { id: parent.id },
      };
    input.issues = [child, parent];
    input.comments[0].issueId = child.id;
    const plan = (await f.request('POST', '/api/v1/imports/linear/append', input)).data;
    const result = await f.request('POST', '/api/v1/imports/linear/append', {
      ...input,
      plan_hash: plan.plan_hash,
    });
    expect(result.status).toBe(200);
    const detail = (
      await f.request(
        'GET',
        '/api/v1/issues/' + targetId(f.init.workspace_id, source.ids.org, 'issues', child.id),
      )
    ).data;
    expect(detail.parent_id).toBe(
      targetId(f.init.workspace_id, source.ids.org, 'issues', parent.id),
    );
    expect(detail.comments).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test('append rejects malformed URLs, integer overflow and oversized media sets during preview', async () => {
  const { f, source } = await imported();
  try {
    for (const change of [
      { url: undefined },
      { url: 'not-a-url' },
      { number: 4000000000 },
      { number: 42, identifier: 'SRC-41' },
    ]) {
      const input = payload(source);
      Object.assign(input.issues[0], change);
      expect((await f.request('POST', '/api/v1/imports/linear/append', input)).status).toBe(422);
    }
    const input = payload(source);
    input.issues[0].description = Array.from(
      { length: 101 },
      (_, i) => 'https://uploads.linear.app/test/' + i,
    ).join('\n');
    expect((await f.request('POST', '/api/v1/imports/linear/append', input)).status).toBe(413);
  } finally {
    await f.close();
  }
});
test('preview rejects an issue status in the wrong team without producing an unusable plan', async () => {
  const { f, source } = await imported();
  try {
    const input = payload(source);
    input.issues[0].team = { id: source.ids.team };
    const wrongState = f.catalog.statuses.find((s) => s.team_id === f.init.team_id);
    await f.db.transaction((tx) =>
      tx.exec(
        'UPDATE linear_source_map SET target_id=? WHERE workspace_id=? AND collection=? AND source_id=?',
        [wrongState.id, f.init.workspace_id, 'workflowStates', source.ids.state],
      ),
    );
    expect((await f.request('POST', '/api/v1/imports/linear/append', input)).status).toBe(422);
  } finally {
    await f.close();
  }
});

test('append rejects non-array labels and ambiguous timestamp strings before reference or media work', async () => {
  const { f, source } = await imported();
  try {
    for (const change of [
      { labelIds: 123 },
      { labelIds: 'abc' },
      { createdAt: 'September 5, 2024' },
      { description: { bad: 'body' } },
    ]) {
      const input = payload(source);
      Object.assign(input.issues[0], change);
      expect((await f.request('POST', '/api/v1/imports/linear/append', input)).status).toBe(422);
    }
  } finally {
    await f.close();
  }
});
