// Runtime schemas are also exported into the OpenAPI document. No hidden UI-only rules.
const text = (maxLength, minLength = 0) => ({ type: 'string', minLength, maxLength });
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const enumeration = (...values) => ({ type: 'string', enum: values });
const uuid = { type: 'string', format: 'uuid' };
const date = { type: 'string', format: 'date' };
const object = (properties, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const stringArray = (items = uuid, maxItems = 100) => ({
  type: 'array',
  items,
  maxItems,
  uniqueItems: true,
});
export const filters = object({
  q: text(200),
  team_id: uuid,
  status_id: uuid,
  category: enumeration('triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'),
  assignee_id: { type: 'string' },
  project_id: uuid,
  cycle_id: uuid,
  label_id: uuid,
  parent_id: uuid,
  kind: enumeration('issue', 'epic'),
  priority: { type: 'integer', minimum: 0, maximum: 4 },
  archived: { type: 'boolean' },
  deleted: { type: 'boolean' },
  due_before: date,
});
const issueFields = {
  title: text(300, 1),
  description: text(100000),
  kind: enumeration('issue', 'epic'),
  status_id: uuid,
  priority: { type: 'integer', minimum: 0, maximum: 4 },
  assignee_id: nullable(uuid),
  project_id: nullable(uuid),
  cycle_id: nullable(uuid),
  milestone_id: nullable(uuid),
  parent_id: nullable(uuid),
  estimate: nullable({ type: 'number', minimum: 0, maximum: 100000 }),
  start_date: nullable(date),
  due_date: nullable(date),
  label_ids: stringArray(),
};
const documentFields = {
  title: text(300, 1),
  body: text(500000),
  project_id: nullable(uuid),
  initiative_id: nullable(uuid),
};
const initiativeFields = {
  name: text(200, 1),
  description: text(100000),
  status: enumeration('planned', 'active', 'completed', 'canceled'),
  owner_id: nullable(uuid),
  target_date: nullable(date),
  project_ids: stringArray(uuid, 100),
};
const versioned = (fields) =>
  object({ ...fields, version: { type: 'integer', minimum: 1 }, archived: { type: 'boolean' } }, [
    'version',
  ]);
export const schemas = {
  DocumentCreate: object(documentFields, ['title']),
  DocumentPatch: versioned(documentFields),
  InitiativeCreate: object(initiativeFields, ['name']),
  InitiativePatch: versioned(initiativeFields),
  LinearFileUnavailable: object({ source_status: { type: 'integer', enum: [404, 410] } }, [
    'source_status',
  ]),
  LinearBind: object(
    {
      source_workspace_id: uuid,
      bindings: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: object(
          {
            collection: text(40, 1),
            record: {
              type: 'object',
              required: ['id'],
              properties: { id: uuid },
              additionalProperties: true,
            },
            target_id: uuid,
          },
          ['collection', 'record', 'target_id'],
        ),
      },
      plan_hash: text(64, 64),
    },
    ['source_workspace_id', 'bindings'],
  ),
  LinearAppend: object(
    {
      source_workspace_id: uuid,
      issues: {
        type: 'array',
        maxItems: 50,
        items: {
          type: 'object',
          required: ['id'],
          properties: { id: uuid },
          additionalProperties: true,
        },
      },
      comments: {
        type: 'array',
        maxItems: 50,
        items: {
          type: 'object',
          required: ['id'],
          properties: { id: uuid },
          additionalProperties: true,
        },
      },
      plan_hash: text(64, 64),
    },
    ['source_workspace_id'],
  ),
  LinearImportCreate: object({ manifest: { type: 'object', additionalProperties: true } }, [
    'manifest',
  ]),
  LinearImportBatch: object(
    {
      collection: text(40, 1),
      records: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: {
          type: 'object',
          required: ['id'],
          properties: { id: uuid },
          additionalProperties: true,
        },
      },
    },
    ['collection', 'records'],
  ),
  LinearImportApply: object(
    {
      plan_hash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      accept_missing_source_files: { type: 'boolean' },
    },
    ['plan_hash'],
  ),
  WorkspacePolicyPatch: object(
    {
      allowed_email_domains: { type: 'array', items: text(253, 1), maxItems: 50 },
      version: { type: 'integer', minimum: 0 },
    },
    ['allowed_email_domains', 'version'],
  ),
  IssueCreate: object({ ...issueFields, team_id: uuid }, ['title', 'team_id']),
  IssuePatch: object(
    {
      ...issueFields,
      version: { type: 'integer', minimum: 1 },
      archived: { type: 'boolean' },
      deleted: { type: 'boolean' },
      position: { type: 'number', minimum: -1e12, maximum: 1e12 },
    },
    ['version'],
  ),
  IssueBulk: object(
    {
      updates: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: object(
          {
            id: uuid,
            patch: object(
              {
                ...issueFields,
                version: { type: 'integer', minimum: 1 },
                archived: { type: 'boolean' },
              },
              ['version'],
            ),
          },
          ['id', 'patch'],
        ),
      },
    },
    ['updates'],
  ),
  Relation: object({ target_id: uuid, type: enumeration('blocks', 'related', 'duplicates') }, [
    'target_id',
    'type',
  ]),
  Comment: object({ body: text(50000, 1) }, ['body']),
  CommentPatch: object({ body: text(50000, 1), version: { type: 'integer', minimum: 1 } }, [
    'body',
    'version',
  ]),
  Login: object(
    {
      email: { ...text(254, 3), format: 'email' },
      password: text(256, 1),
      workspace_slug: text(64),
    },
    ['email', 'password'],
  ),
  ForgotPassword: object({ email: { ...text(254, 3), format: 'email' } }, ['email']),
  ResetPassword: object(
    { token: { ...text(43, 43), pattern: '^[A-Za-z0-9_-]{43}$' }, password: text(256, 12) },
    ['token', 'password'],
  ),
  TeamRename: object({ name: text(120, 1), expected_name: text(120, 1) }, [
    'name',
    'expected_name',
  ]),
  TeamDelete: object({ confirm_key: text(20, 1) }, ['confirm_key']),
  Invite: object(
    {
      email: { ...text(254, 3), format: 'email' },
      role: enumeration('admin', 'member', 'viewer'),
      delivery: enumeration('email'),
    },
    ['email', 'role'],
  ),
  AcceptInvite: object({ token: text(100, 20), name: text(100, 1), password: text(256, 12) }, [
    'token',
    'name',
    'password',
  ]),
  Token: object(
    {
      name: text(100, 1),
      scopes: {
        type: 'array',
        items: enumeration('read', 'write', 'admin'),
        minItems: 1,
        maxItems: 3,
        uniqueItems: true,
      },
      days: { type: 'integer', minimum: 1, maximum: 365 },
    },
    ['name', 'scopes'],
  ),
  MemberRole: object({ role: enumeration('owner', 'admin', 'member', 'viewer') }, ['role']),
  Profile: object({ name: text(100, 1) }, ['name']),
  Team: object({ key: { ...text(10, 2), pattern: '^[A-Z][A-Z0-9]{1,9}$' }, name: text(100, 1) }, [
    'key',
    'name',
  ]),
  Status: object(
    {
      team_id: uuid,
      name: text(80, 1),
      category: enumeration('triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'),
      color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
      position: { type: 'number', minimum: 0, maximum: 10000 },
    },
    ['team_id', 'name', 'category', 'color'],
  ),
  Label: object({ name: text(80, 1), color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } }, [
    'name',
    'color',
  ]),
  ProjectCreate: object(
    {
      name: text(200, 1),
      description: text(100000),
      status: enumeration('planned', 'in_progress', 'paused', 'completed', 'canceled'),
      health: enumeration('on_track', 'at_risk', 'off_track'),
      lead_id: nullable(uuid),
      start_date: nullable(date),
      target_date: nullable(date),
      team_ids: stringArray(uuid, 20),
    },
    ['name', 'team_ids'],
  ),
  ProjectPatch: object(
    {
      name: text(200, 1),
      description: text(100000),
      status: enumeration('planned', 'in_progress', 'paused', 'completed', 'canceled'),
      health: enumeration('on_track', 'at_risk', 'off_track'),
      lead_id: nullable(uuid),
      start_date: nullable(date),
      target_date: nullable(date),
      version: { type: 'integer', minimum: 1 },
      archived: { type: 'boolean' },
    },
    ['version'],
  ),
  Milestone: object({ project_id: uuid, name: text(200, 1), target_date: nullable(date) }, [
    'project_id',
    'name',
  ]),
  CyclePatch: object(
    {
      name: text(200, 1),
      start_date: date,
      end_date: date,
      version: { type: 'integer', minimum: 1 },
    },
    ['version'],
  ),
  Cycle: object({ team_id: uuid, name: text(200, 1), start_date: date, end_date: date }, [
    'team_id',
    'name',
    'start_date',
    'end_date',
  ]),
  View: object({ name: text(100, 1), filters, shared: { type: 'boolean' } }, ['name', 'filters']),
  Attachment: object(
    {
      filename: text(180, 1),
      mime: text(120, 1),
      bytes: { type: 'integer', minimum: 1, maximum: 104857600 },
    },
    ['filename', 'mime', 'bytes'],
  ),
  Module: object({ enabled: { type: 'boolean' } }, ['enabled']),
  GitHubConfig: object({
    review_status_id: nullable(uuid),
    done_status_id: nullable(uuid),
    notify: { type: 'boolean' },
  }),
  SlackConfig: object({
    notify: { type: 'boolean' },
    team_id: uuid,
    user_map: { type: 'object', maxProperties: 100, additionalProperties: uuid },
  }),
};
export { object, text, uuid, nullable };
