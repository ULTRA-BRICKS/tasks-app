import { assert, requirePermission } from './errors.mjs';
export const MODULES = Object.freeze([
  {
    id: 'identity',
    name: 'People & workspace',
    required: true,
    depends: [],
    description: 'Members, roles, sessions, invitations and API tokens.',
  },
  {
    id: 'tickets',
    name: 'Tickets',
    required: true,
    depends: ['identity'],
    description: 'Issues, epics, workflows, labels, relations, comments and activity.',
  },
  {
    id: 'planning',
    name: 'Projects & milestones',
    depends: ['tickets'],
    description: 'Cross-team projects, milestones, health and target dates.',
  },
  {
    id: 'cycles',
    name: 'Cycles',
    depends: ['tickets'],
    description: 'Time-boxed team iterations. Independent of projects.',
  },
  {
    id: 'views',
    name: 'Saved views',
    depends: ['tickets'],
    description: 'Private or shared reusable filters.',
  },
  {
    id: 'notifications',
    name: 'Inbox',
    depends: ['tickets'],
    description: 'Assignment, subscription and comment notifications.',
  },
  {
    id: 'attachments',
    name: 'Attachments',
    depends: ['tickets'],
    description: 'Private uploads with size limits and content-type verification.',
  },
  {
    id: 'github',
    name: 'GitHub',
    depends: ['tickets'],
    description: 'Issue import/export, linked pull requests, review and merge automation.',
  },
  {
    id: 'slack',
    name: 'Slack',
    depends: ['tickets'],
    description: 'Create from slash commands or messages; optional channel updates.',
  },
]);
export async function listModules(tx, workspace) {
  const rows = await tx.all(
    'SELECT module,enabled,config FROM module_settings WHERE workspace_id=?',
    [workspace],
  );
  return MODULES.map((m) => ({
    ...m,
    enabled: rows.find((r) => r.module === m.id)?.enabled !== 0,
    config: JSON.parse(rows.find((r) => r.module === m.id)?.config ?? '{}'),
  }));
}
export async function assertModule(tx, workspace, module) {
  const row = await tx.one(
    'SELECT enabled FROM module_settings WHERE workspace_id=? AND module=?',
    [workspace, module],
  );
  assert(row?.enabled !== 0, 409, 'MODULE_DISABLED', `The ${module} module is disabled`);
}
export async function setModule(tx, actor, module, enabled) {
  requirePermission(actor, 'admin');
  const descriptor = MODULES.find((m) => m.id === module);
  assert(descriptor, 404, 'NOT_FOUND', 'Unknown module');
  assert(
    !descriptor.required || enabled,
    422,
    'REQUIRED_MODULE',
    'A required module cannot be disabled',
  );
  const modules = await listModules(tx, actor.workspace_id);
  if (enabled) {
    const absent = descriptor.depends.filter((d) => !modules.find((m) => m.id === d)?.enabled);
    assert(
      !absent.length,
      409,
      'MODULE_DEPENDENCY',
      `Enable dependencies first: ${absent.join(', ')}`,
    );
  } else {
    const dependents = modules.filter((m) => m.enabled && m.depends.includes(module));
    assert(
      !dependents.length,
      409,
      'MODULE_DEPENDENCY',
      `Disable dependents first: ${dependents.map((m) => m.id).join(', ')}`,
    );
  }
  await tx.exec(
    'INSERT INTO module_settings(workspace_id,module,enabled,config) VALUES(?,?,?,?) ON CONFLICT(workspace_id,module) DO UPDATE SET enabled=excluded.enabled',
    [actor.workspace_id, module, enabled ? 1 : 0, '{}'],
  );
  return { module, enabled };
}
