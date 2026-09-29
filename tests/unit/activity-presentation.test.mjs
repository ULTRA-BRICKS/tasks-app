import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
import { sourceFixture } from './linear-import-fixture.mjs';
import { targetId } from '../../packages/imports/linear-source.mjs';

// Structured field changes are the presentation contract; `from → to` keeps assertions readable.
const pair = (event, field) => {
  const change = event.changes.find((c) => c.field === field);
  return change && `${change.from} → ${change.to}`;
};

async function importedFixture() {
  const f = await fixture(),
    source = sourceFixture();
  const done = crypto.randomUUID();
  source.data.workflowStates.push({
    ...source.data.workflowStates[0],
    id: done,
    name: 'Done',
    type: 'completed',
  });
  source.data.issueHistory[0].history.nodes = [
    {
      ...source.data.issueHistory[0].history.nodes[0],
      fromStateId: source.ids.state,
      toStateId: done,
      fromTitle: null,
      toTitle: null,
    },
    {
      id: crypto.randomUUID(),
      createdAt: '2024-03-02T00:00:00Z',
      actorId: null,
      updatedDescription: true,
    },
    {
      id: crypto.randomUUID(),
      createdAt: '2024-03-03T00:00:00Z',
      actorId: source.ids.user,
      fromPriority: 0,
      toPriority: 1,
      toAssigneeId: source.ids.user,
      fromAssigneeId: null,
      addedLabelIds: [source.ids.label],
      changes: { toProjectMilestoneId: source.ids.milestone },
    },
    {
      id: crypto.randomUUID(),
      createdAt: '2024-03-04T00:00:00Z',
      actorId: source.ids.user,
      relationChanges: [{ type: 'ar', identifier: 'SRC-8' }],
    },
  ];
  source.manifest.counts = Object.fromEntries(
    Object.entries(source.data).map(([k, v]) => [k, v.length]),
  );
  const created = await f.request('POST', '/api/v1/imports/linear', { manifest: source.manifest });
  expect(created.status).toBe(201);
  for (const [collection, records] of Object.entries(source.data))
    if (records.length) {
      expect(
        (
          await f.request('POST', `/api/v1/imports/linear/${created.data.id}/records`, {
            collection,
            records,
          })
        ).status,
      ).toBe(200);
    }
  const plan = await f.request('POST', `/api/v1/imports/linear/${created.data.id}/plan`);
  expect(plan.status).toBe(200);
  expect(
    (
      await f.request('POST', `/api/v1/imports/linear/${created.data.id}/apply`, {
        plan_hash: plan.data.plan_hash,
      })
    ).status,
  ).toBe(200);
  const issue = targetId(f.init.workspace_id, source.ids.org, 'issues', source.ids.issue);
  return { f, source, issue };
}

test('already-imported activity resolves original values without rewriting audit records', async () => {
  const { f, source, issue } = await importedFixture();
  try {
    const before = await f.db.transaction((tx) =>
      tx.all('SELECT id,action,data,created_at FROM activity ORDER BY id'),
    );
    // A later rename in Tasks must not rewrite the meaning of imported history.
    await f.db.transaction((tx) =>
      tx.exec('UPDATE statuses SET name=? WHERE id=?', [
        'Renamed locally',
        targetId(f.init.workspace_id, source.ids.org, 'workflowStates', source.ids.state),
      ]),
    );
    const detail = await f.request('GET', '/api/v1/issues/' + issue);
    expect(detail.status).toBe(200);
    const events = detail.data.activity;
    const status = events.find((a) => a.data.toStateId);
    expect(status.summary).toBe('updated the task');
    expect(status.changes).toEqual([
      { kind: 'value', field: 'status', label: 'Status', from: 'Todo', to: 'Done' },
    ]);
    const description = events.find((a) => a.data.updatedDescription);
    // Linear history records that the description changed, never its text.
    expect(description.changes).toEqual([
      { kind: 'text', field: 'description', label: 'Description', from: null, to: null },
    ]);
    expect(description.actor_name).toBe('Linear');
    const combined = events.find((a) => a.data.toPriority === 1);
    expect(pair(combined, 'priority')).toBe('No priority → Urgent');
    expect(pair(combined, 'assignee')).toBe('Unassigned → Source author');
    expect(pair(combined, 'milestone')).toBe('No milestone → Original milestone');
    expect(combined.changes.find((c) => c.field === 'labels')).toMatchObject({
      added: ['Imported fixture'],
      removed: [],
    });
    expect(events.find((a) => a.data.relationChanges).summary).toBe('updated task links: SRC-8');
    expect(events.every((a) => a.action === 'linear_imported_change')).toBe(true);
    const after = await f.db.transaction((tx) =>
      tx.all('SELECT id,action,data,created_at FROM activity ORDER BY id'),
    );
    expect(after).toEqual(before);
  } finally {
    await f.close();
  }
});

test('unresolved and unsupported historical values stay readable without leaking raw IDs', async () => {
  const { f, issue } = await importedFixture();
  try {
    const record = await f.db.transaction((tx) =>
      tx.one('SELECT id FROM activity WHERE issue_id=? LIMIT 1', [issue]),
    );
    const unavailable = crypto.randomUUID();
    await f.db.transaction((tx) =>
      tx.exec('UPDATE activity SET data=? WHERE id=?', [
        JSON.stringify({ fromStateId: unavailable, toStateId: null }),
        record.id,
      ]),
    );
    let row = (await f.request('GET', '/api/v1/issues/' + issue)).data.activity.find(
      (a) => a.id === record.id,
    );
    expect(pair(row, 'status')).toBe('Unavailable status → Not set');
    expect(JSON.stringify([row.summary, row.changes, row.details])).not.toContain(unavailable);
    await f.db.transaction((tx) =>
      tx.exec('UPDATE activity SET data=? WHERE id=?', [
        JSON.stringify({
          changes: { futureInternalCode: true },
          archivedAt: '2024-01-01T00:00:00Z',
        }),
        record.id,
      ]),
    );
    row = (await f.request('GET', '/api/v1/issues/' + issue)).data.activity.find(
      (a) => a.id === record.id,
    );
    expect(row.summary).toBe('updated the task in Linear');
    expect(row.details).toEqual([]);
    expect(row.changes).toEqual([]);
    expect(
      (await f.request('GET', '/api/v1/issues/' + issue, undefined, { anonymous: true })).status,
    ).toBe(401);
  } finally {
    await f.close();
  }
});

test('historical booleans and empty selections are distinguished from source metadata', async () => {
  const { describeImportedChange } =
    await import('../../packages/server/modules/tickets/activity.mjs');
  expect(describeImportedChange({ archivedAt: '2024-01-01T00:00:00Z' }).summary).toBe(
    'updated the task in Linear',
  );
  expect(describeImportedChange({ archived: true }).summary).toBe('archived the task');
  expect(describeImportedChange({ archived: false }).summary).toBe(
    'restored the task from the archive',
  );
  expect(describeImportedChange({ trashed: false }).summary).toBe('restored the task from trash');
  expect(pair(describeImportedChange({ fromEstimate: 3, toEstimate: 0 }), 'estimate')).toBe(
    '3 → 0',
  );
  expect(pair(describeImportedChange({ fromPriority: 1, toPriority: 0 }), 'priority')).toBe(
    'Urgent → No priority',
  );
  expect(
    describeImportedChange({ changes: { descriptionUpdatedByIds: ['source-author'] } }).changes,
  ).toEqual([{ kind: 'text', field: 'description', label: 'Description', from: null, to: null }]);
  expect(describeImportedChange('{broken')).toEqual({
    summary: 'updated the task in Linear',
    changes: [],
    details: [],
  });
  expect(pair(describeImportedChange({ fromPriority: 0, toPriority: 'map' }), 'priority')).toBe(
    'No priority → Unknown priority',
  );
  expect(
    pair(describeImportedChange({ fromDueDate: null, toDueDate: '2024-03-10' }), 'due_date'),
  ).toBe('No due date → Mar 10, 2024');
});

test('unknown native event codes never become UI labels or inherited object properties', async () => {
  const { presentActivity } = await import('../../packages/server/modules/tickets/activity.mjs');
  const tx = {
    one: () => {
      throw Error('Unexpected lookup for native activity');
    },
    all: () => {
      throw Error('Unexpected lookup for native activity');
    },
  };
  const rows = ['constructor', '__proto__', 'future_internal_event'].map((action) => ({
    action,
    data: '{}',
  }));
  const rendered = await presentActivity(tx, 'workspace', 'issue', rows);
  expect(rendered.map((row) => row.summary)).toEqual([
    'updated the task',
    'updated the task',
    'updated the task',
  ]);
});

test('explicit cleared fields override stale nested values and schema-shaped milestones remain readable', async () => {
  const { describeImportedChange } =
    await import('../../packages/server/modules/tickets/activity.mjs');
  const resolve = (_collection, id) =>
    id === 'old-person' ? 'Previous assignee' : 'Stale assignee';
  expect(
    pair(
      describeImportedChange(
        {
          fromAssigneeId: 'old-person',
          toAssigneeId: null,
          changes: { toAssigneeId: 'stale-person' },
        },
        resolve,
      ),
      'assignee',
    ),
  ).toBe('Previous assignee → Unassigned');
  expect(
    pair(
      describeImportedChange({
        fromProjectMilestone: { id: crypto.randomUUID(), name: 'Initial release' },
        toProjectMilestone: { id: crypto.randomUUID(), name: 'Public release' },
      }),
      'milestone',
    ),
  ).toBe('Initial release → Public release');
  expect(
    pair(
      describeImportedChange({
        fromProjectMilestone: { id: crypto.randomUUID(), name: 'Initial release' },
        toProjectMilestone: null,
        changes: { toProjectMilestoneId: crypto.randomUUID() },
      }),
      'milestone',
    ),
  ).toBe('Initial release → No milestone');
});

test('native comment-edit and unlink verbs are preserved', async () => {
  const { presentActivity } = await import('../../packages/server/modules/tickets/activity.mjs');
  const result = await presentActivity({}, 'workspace', 'issue', [
    { action: 'edited comment', data: {} },
    { action: 'unlinked', data: {} },
  ]);
  expect(result.map((event) => event.summary)).toEqual(['edited a comment', 'removed a task link']);
});

test('every history summary and fallback name uses task wording', async () => {
  const { presentActivity, describeImportedChange } =
    await import('../../packages/server/modules/tickets/activity.mjs');
  const native = [
    'created',
    'updated',
    'deleted',
    'restored',
    'commented',
    'linked',
    'unlinked',
    'edited comment',
    'attached',
    'archived',
  ].map((action) => ({ action, data: {} }));
  const nativeSummaries = (await presentActivity({}, 'workspace', 'task', native)).map(
    (event) => event.summary,
  );
  expect(nativeSummaries.slice(0, 7)).toEqual([
    'created the task',
    'updated the task',
    'moved the task to trash',
    'restored the task',
    'added a comment',
    'linked a task',
    'removed a task link',
  ]);
  const imported = describeImportedChange({
    sourceCreated: true,
    fromParentId: crypto.randomUUID(),
    toParentId: null,
    relationChanges: [{ identifier: 'ENG-2', type: 'r' }],
    archived: true,
    trashed: true,
  });
  expect(imported.summary).toBe('created the task in Linear');
  expect(imported.changes).toEqual([
    {
      kind: 'value',
      field: 'parent',
      label: 'Parent task',
      from: 'Unavailable task',
      to: 'No parent',
    },
  ]);
  expect(imported.details).toEqual([
    'updated task links: ENG-2',
    'archived the task',
    'moved the task to trash',
  ]);
  for (const line of [
    ...nativeSummaries,
    imported.summary,
    ...imported.details,
    ...imported.changes.map((c) => c.label),
  ])
    expect(line).not.toMatch(/\bissues?\b/i);
});

test('history lookups retain indexed collection coordinates and avoid reverse source-map scans', async () => {
  const { presentActivity } = await import('../../packages/server/modules/tickets/activity.mjs');
  const workspace = crypto.randomUUID(),
    org = crypto.randomUUID(),
    sourceId = crypto.randomUUID(),
    importId = crypto.randomUUID();
  const issue = targetId(workspace, org, 'issues', sourceId),
    queries = [];
  const tx = {
    one: () => {
      throw Error('Unindexed reverse source-map lookup');
    },
    all: async (sql, args) => {
      queries.push({ sql, args });
      if (sql.includes('JOIN linear_imports'))
        return [{ import_id: importId, source_id: sourceId, source_workspace_id: org }];
      return [];
    },
  };
  const rows = [
    {
      action: 'linear_imported_change',
      data: {
        fromStateId: crypto.randomUUID(),
        toStateId: crypto.randomUUID(),
        addedLabelIds: Array.from({ length: 201 }, () => crypto.randomUUID()),
      },
    },
  ];
  await presentActivity(tx, workspace, issue, rows, [
    { provider: 'linear', external_id: sourceId },
  ]);
  expect(queries).toHaveLength(3);
  expect(queries[0].sql).toContain("r.collection='issues'");
  expect(queries[0].sql).toContain('r.source_id=?');
  for (const query of queries.slice(1)) {
    expect(query.sql).toContain('collection=?');
    expect(query.args[0]).toBe(workspace);
    expect(query.args[1]).toBe(importId);
  }
  expect(queries.some((query) => query.sql.includes('linear_source_map'))).toBe(false);
});
