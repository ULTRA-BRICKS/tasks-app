import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';

const byField = (event) =>
  Object.fromEntries(event.changes.map((change) => [change.field, change]));

async function edit(f, key, patch) {
  const current = (await f.request('GET', '/api/v1/issues/' + key)).data;
  const response = await f.request('PATCH', '/api/v1/issues/' + key, {
    version: current.version,
    ...patch,
  });
  expect(response.status).toBe(200);
  // Activity orders by millisecond timestamp, then random ID: keep each edit in its own millisecond.
  await Bun.sleep(2);
  return response.data;
}
const updates = async (f, key) =>
  (await f.request('GET', '/api/v1/issues/' + key)).data.activity
    .filter((event) => event.action === 'updated')
    .reverse();

test('every native field update is presented as old → new with names, not IDs', async () => {
  const f = await fixture();
  try {
    const parent = (await f.create({ title: 'Parent task' })).data;
    const task = (await f.create({ title: 'Activity subject', description: 'First line' })).data;
    const todo = task.status_id;
    const done = f.catalog.statuses.find(
      (s) => s.team_id === f.init.team_id && s.category === 'completed',
    );
    const project = (
      await f.request('POST', '/api/v1/projects', { name: 'Launch', team_ids: [f.init.team_id] })
    ).data;
    const milestone = (
      await f.request('POST', '/api/v1/milestones', { name: 'Beta', project_id: project.id })
    ).data;
    const cycle = (
      await f.request('POST', '/api/v1/cycles', {
        name: 'Sprint 7',
        team_id: f.init.team_id,
        start_date: '2026-09-01',
        end_date: '2026-09-14',
      })
    ).data;
    const bug = (await f.request('POST', '/api/v1/labels', { name: 'Crash', color: '#ff0000' }))
      .data;
    const backend = (
      await f.request('POST', '/api/v1/labels', { name: 'Search', color: '#00ff00' })
    ).data;

    await edit(f, task.id, { status_id: done.id, assignee_id: f.init.user_id });
    await edit(f, task.id, {
      priority: 3,
      estimate: 3,
      start_date: '2026-09-02',
      due_date: '2026-09-25',
      title: 'Activity subject renamed',
    });
    await edit(f, task.id, {
      project_id: project.id,
      milestone_id: milestone.id,
      cycle_id: cycle.id,
      parent_id: parent.id,
      label_ids: [bug.id, backend.id],
    });
    await edit(f, task.id, { label_ids: [backend.id], description: 'First line\nSecond line' });
    await edit(f, task.id, { assignee_id: null, due_date: null, estimate: 0, kind: 'epic' });
    await edit(f, task.id, { archived: true });
    await edit(f, task.id, { archived: false });

    const events = await updates(f, task.id);
    expect(events.map((event) => event.summary)).toEqual([
      ...Array(5).fill('updated the task'),
      'archived the task',
      'restored the task from the archive',
    ]);
    expect(events.slice(5).map((event) => [event.changes, event.details])).toEqual([
      [[], []],
      [[], []],
    ]);

    const statusName = f.catalog.statuses.find((s) => s.id === todo).name;
    expect(events[0].changes).toEqual([
      { kind: 'value', field: 'status', label: 'Status', from: statusName, to: done.name },
      {
        kind: 'value',
        field: 'assignee',
        label: 'Assignee',
        from: 'Unassigned',
        to: 'Owner',
        from_id: null,
        to_id: f.init.user_id,
      },
    ]);
    expect(byField(events[1])).toEqual({
      priority: {
        kind: 'value',
        field: 'priority',
        label: 'Priority',
        from: 'No priority',
        to: 'Medium',
      },
      estimate: {
        kind: 'value',
        field: 'estimate',
        label: 'Estimate',
        from: 'Not estimated',
        to: '3',
      },
      start_date: {
        kind: 'value',
        field: 'start_date',
        label: 'Start date',
        from: 'No start date',
        to: 'Sep 2, 2026',
      },
      due_date: {
        kind: 'value',
        field: 'due_date',
        label: 'Due date',
        from: 'No due date',
        to: 'Sep 25, 2026',
      },
      title: {
        kind: 'value',
        field: 'title',
        label: 'Title',
        from: 'Activity subject',
        to: 'Activity subject renamed',
      },
    });
    const third = byField(events[2]);
    expect(third.project).toMatchObject({ from: 'No project', to: 'Launch' });
    expect(third.milestone).toMatchObject({ from: 'No milestone', to: 'Beta' });
    expect(third.cycle).toMatchObject({ from: 'No cycle', to: 'Sprint 7' });
    expect(third.parent).toMatchObject({ label: 'Parent task', from: 'No parent', to: parent.key });
    expect(third.labels).toEqual({
      kind: 'labels',
      field: 'labels',
      label: 'Labels',
      added: ['Crash', 'Search'],
      removed: [],
    });
    expect(byField(events[3])).toEqual({
      labels: { kind: 'labels', field: 'labels', label: 'Labels', added: [], removed: ['Crash'] },
      description: {
        kind: 'text',
        field: 'description',
        label: 'Description',
        from: 'First line',
        to: 'First line\nSecond line',
      },
    });
    expect(byField(events[4])).toEqual({
      assignee: {
        kind: 'value',
        field: 'assignee',
        label: 'Assignee',
        from: 'Owner',
        to: 'Unassigned',
        from_id: f.init.user_id,
        to_id: null,
      },
      due_date: {
        kind: 'value',
        field: 'due_date',
        label: 'Due date',
        from: 'Sep 25, 2026',
        to: 'No due date',
      },
      estimate: { kind: 'value', field: 'estimate', label: 'Estimate', from: '3', to: '0' },
      type: { kind: 'value', field: 'type', label: 'Type', from: 'Task', to: 'Epic' },
    });
    // Display text never shows an ID; person IDs travel only in `from_id`/`to_id` (for avatars).
    const text = JSON.stringify(
      events.map((e) => [
        e.summary,
        e.changes.map((c) => Object.entries(c).filter(([key]) => !key.endsWith('_id'))),
        e.details,
      ]),
    );
    for (const raw of [
      done.id,
      f.init.user_id,
      project.id,
      milestone.id,
      cycle.id,
      parent.id,
      bug.id,
    ])
      expect(text).not.toContain(raw);
    expect(text).not.toMatch(/\bissues?\b/i);
  } finally {
    await f.close();
  }
});

test('stored legacy rows are presented without rewriting audit bytes or leaking foreign names', async () => {
  const f = await fixture();
  try {
    const task = (await f.create({ title: 'Legacy subject' })).data;
    const label = (await f.request('POST', '/api/v1/labels', { name: 'Kept', color: '#123456' }))
      .data;
    // A second workspace's status and label must never resolve inside this workspace.
    await f.db.transaction(async (tx) => {
      await tx.exec('INSERT INTO workspaces(id,name,slug,created_at) VALUES(?,?,?,?)', [
        'other-ws',
        'Other',
        'other',
        '2026-09-01T00:00:00Z',
      ]);
      await tx.exec('INSERT INTO teams(id,workspace_id,key,name) VALUES(?,?,?,?)', [
        'other-team',
        'other-ws',
        'OTH',
        'Other team',
      ]);
      await tx.exec(
        'INSERT INTO statuses(id,workspace_id,team_id,name,category,color,position) VALUES(?,?,?,?,?,?,?)',
        ['other-status', 'other-ws', 'other-team', 'Secret status', 'started', '#000000', 1],
      );
      await tx.exec('INSERT INTO labels(id,workspace_id,name,color) VALUES(?,?,?,?)', [
        'other-label',
        'other-ws',
        'Secret label',
        '#000000',
      ]);
      const rows = [
        ['legacy-1', 'updated', { status_id: { from: task.status_id, to: 'other-status' } }],
        [
          'legacy-2',
          'updated',
          { position: { from: 1, to: 2 }, mystery_field: { from: 1, to: 2 } },
        ],
        [
          'legacy-3',
          'updated',
          {
            label_ids: { from: [label.id], to: [label.id, 'other-label'] },
            archived: true,
          },
        ],
        ['legacy-4', 'updated', { label_ids: { from: [label.id], to: [label.id] } }],
        ['legacy-5', 'deleted', { deleted: true }],
        [
          'legacy-6',
          'updated',
          {
            team_id: { from: f.init.team_id, to: 'other-team' },
            key: { from: task.key, to: 'OTH-4' },
          },
        ],
        ['legacy-7', 'updated', 'not json'],
      ];
      for (const [index, [row, action, data]] of rows.entries())
        await tx.exec(
          'INSERT INTO activity(id,workspace_id,issue_id,actor_id,action,data,created_at) VALUES(?,?,?,?,?,?,?)',
          [
            row,
            f.init.workspace_id,
            task.id,
            f.init.user_id,
            action,
            typeof data === 'string' ? data : JSON.stringify(data),
            `2026-09-2${index}T10:00:00.000Z`,
          ],
        );
    });
    const before = await f.db.transaction((tx) =>
      tx.all("SELECT * FROM activity WHERE id LIKE 'legacy-%' ORDER BY id"),
    );
    const detail = (await f.request('GET', '/api/v1/issues/' + task.id)).data;
    const event = (id) => detail.activity.find((a) => a.id === id);
    expect(event('legacy-1').changes).toEqual([
      {
        kind: 'value',
        field: 'status',
        label: 'Status',
        from: f.catalog.statuses.find((s) => s.id === task.status_id).name,
        to: 'Unavailable status',
      },
    ]);
    expect(event('legacy-2')).toMatchObject({
      summary: 'updated the task',
      changes: [],
      details: ['reordered the task'],
    });
    // An archive is its own entry (it must not merge into a group of edits); its changes stay listed.
    expect(event('legacy-3')).toMatchObject({
      summary: 'archived the task',
      changes: [
        {
          kind: 'labels',
          field: 'labels',
          label: 'Labels',
          added: ['Unavailable label'],
          removed: [],
        },
      ],
      details: [],
    });
    expect(event('legacy-4')).toMatchObject({ changes: [], details: [] });
    expect(event('legacy-5')).toMatchObject({ summary: 'moved the task to trash', changes: [] });
    expect(event('legacy-6').changes).toEqual([
      { kind: 'value', field: 'team', label: 'Team', from: 'Engineering', to: 'Unavailable team' },
      { kind: 'value', field: 'id', label: 'ID', from: task.key, to: 'OTH-4' },
    ]);
    expect(event('legacy-7')).toMatchObject({
      summary: 'updated the task',
      changes: [],
      details: [],
    });
    const shown = JSON.stringify(detail.activity.map((a) => [a.summary, a.changes, a.details]));
    for (const secret of ['Secret status', 'Secret label', 'Other team', 'mystery', 'other-status'])
      expect(shown).not.toContain(secret);
    const after = await f.db.transaction((tx) =>
      tx.all("SELECT * FROM activity WHERE id LIKE 'legacy-%' ORDER BY id"),
    );
    expect(after).toEqual(before);
  } finally {
    await f.close();
  }
});

test('assignee changes to imported people use their workspace person name', async () => {
  const f = await fixture();
  try {
    const task = (await f.create({ title: 'Imported assignee' })).data,
      person = crypto.randomUUID();
    await f.db.transaction((tx) =>
      tx.exec(
        'INSERT INTO source_people(id,workspace_id,provider,source_id,name,email) VALUES(?,?,?,?,?,?)',
        [person, f.init.workspace_id, 'linear', 'lin-1', 'Imported Person', null],
      ),
    );
    await edit(f, task.id, { assignee_id: person });
    const [event] = await updates(f, task.id);
    expect(event.changes).toEqual([
      {
        kind: 'value',
        field: 'assignee',
        label: 'Assignee',
        from: 'Unassigned',
        to: 'Imported Person',
        from_id: null,
        to_id: person,
      },
    ]);
  } finally {
    await f.close();
  }
});
