import { id, now } from './core/crypto.mjs';
import { bootstrap, sessionScopes } from './modules/identity/service.mjs';
import { createIssue, addComment, addRelation } from './modules/tickets/service.mjs';
import { createProject, createCycle, createMilestone } from './modules/planning/service.mjs';
export async function seedDemo(db) {
  const init = await bootstrap(db, {
    email: 'demo@example.test',
    name: 'Alex Morgan',
    password: 'local-demo-password',
    workspaceName: 'Acme Studio',
    slug: 'acme',
  });
  return db.transaction(async (tx) => {
    await tx.lock(init.workspace_id);
    const actor = {
      id: init.user_id,
      workspace_id: init.workspace_id,
      name: 'Alex Morgan',
      role: 'owner',
      scopes: sessionScopes('owner'),
    };
    const first = await tx.one('SELECT password_hash FROM users WHERE id=?', [actor.id]);
    const people = [{ id: actor.id, name: actor.name }];
    for (const name of ['Jamie Chen', 'Sam Rivera', 'Taylor Park', 'Casey Brooks']) {
      const userId = id();
      await tx.exec('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)', [
        userId,
        name.toLowerCase().replace(' ', '.') + '@example.test',
        name,
        first.password_hash,
        now(),
      ]);
      await tx.exec('INSERT INTO memberships(workspace_id,user_id,role) VALUES(?,?,?)', [
        actor.workspace_id,
        userId,
        'member',
      ]);
      people.push({ id: userId, name });
    }
    const project = await createProject(tx, actor, {
      name: 'A calmer way to ship',
      description:
        '# Product foundations\n\nMake planning lightweight without hiding the details.\n\n- [x] Define the issue model\n- [ ] Review the first release',
      team_ids: [init.team_id],
      status: 'in_progress',
      lead_id: actor.id,
      start_date: '2026-09-01',
      target_date: '2026-09-30',
    });
    await createProject(tx, actor, {
      name: 'Developer experience',
      description: 'A predictable API and CLI for people and agents.',
      team_ids: [init.team_id],
      status: 'planned',
      lead_id: people[1].id,
      target_date: '2026-10-15',
    });
    const cycle = await createCycle(tx, actor, {
      team_id: init.team_id,
      name: 'Cycle 12',
      start_date: '2026-09-07',
      end_date: '2026-09-20',
    });
    const milestone = await createMilestone(tx, actor, {
      project_id: project.id,
      name: 'Private beta',
      target_date: '2026-09-18',
    });
    const statuses = await tx.all('SELECT * FROM statuses WHERE team_id=? ORDER BY position', [
      init.team_id,
    ]);
    const labels = await tx.all('SELECT * FROM labels WHERE workspace_id=? ORDER BY name', [
      actor.workspace_id,
    ]);
    const epic = await createIssue(tx, actor, {
      team_id: init.team_id,
      title: 'Make every issue a useful conversation',
      kind: 'epic',
      description: 'The first release should feel coherent from keyboard to API.',
      project_id: project.id,
      status_id: statuses[3].id,
      assignee_id: actor.id,
      priority: 2,
    });
    const titles = [
      'Preserve drafts when switching between issues',
      'Add keyboard navigation to the command menu',
      'Keep board moves in sync across teammates',
      'Show a clear empty state for filtered views',
      'Make issue descriptions readable in Markdown',
      'Link pull requests to their original issues',
      'Improve focus visibility in dark mode',
      'Add project health and target dates',
      'Support private image and document attachments',
      'Review invitation and member permissions',
      'Document API pagination and version conflicts',
      'Make recurring cycles easy to understand',
      'Add a loading state to the issue detail panel',
      'Bring issue updates into Slack',
      'Ship the design token reference',
      'Test mobile navigation and narrow layouts',
      'Validate due dates without timezone surprises',
      'Add a stable CLI output mode for agents',
    ];
    const created = [];
    for (const [n, title] of titles.entries()) {
      const status = statuses[[3, 4, 3, 2, 5, 2, 3, 5, 2, 0, 1, 1, 4, 0, 5, 2, 3, 1][n]];
      created.push(
        await createIssue(tx, actor, {
          team_id: init.team_id,
          title,
          description: `## Why\n\n${title}. The experience should be predictable for people and agents.\n\n## Acceptance criteria\n\n- [ ] Handles the normal workflow\n- [ ] Includes an error and empty state\n- [ ] Works with a keyboard`,
          status_id: status.id,
          priority: [2, 3, 1, 0, 3][n % 5],
          assignee_id: n % 6 === 0 ? null : people[n % 5].id,
          project_id: project.id,
          cycle_id: n < 12 ? cycle.id : null,
          parent_id: n < 5 ? epic.id : null,
          milestone_id: n < 7 ? milestone.id : null,
          label_ids: [labels[n % labels.length].id],
          estimate: [1, 2, 3, 5][n % 4],
          due_date: n % 3 === 0 ? '2026-09-18' : null,
        }),
      );
    }
    await addComment(
      tx,
      actor,
      created[0].id,
      'Please preserve **unsaved drafts** when switching away. Do not overwrite a newer server version.',
    );
    await addRelation(tx, actor, created[2].id, { target_id: created[0].id, type: 'blocks' });
    return {
      workspace_id: init.workspace_id,
      team_id: init.team_id,
      issues: created.length + 1,
      email: 'demo@example.test',
      password: 'local-demo-password',
      note: 'Synthetic local fixtures only. Never use these credentials in production.',
    };
  });
}
