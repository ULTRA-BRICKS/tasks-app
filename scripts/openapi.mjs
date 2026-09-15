import { PRODUCT_NAME, PRODUCT_VERSION } from '../packages/config/product.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { schemas, filters } from '../packages/contracts/schemas.mjs';
export function toType(schema) {
  if (schema.anyOf) return schema.anyOf.map(toType).join(' | ');
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
  if (schema.type === 'null') return 'null';
  if (schema.type === 'string') return 'string';
  if (['number', 'integer'].includes(schema.type)) return 'number';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'array') return `Array<${toType(schema.items)}>`;
  if (schema.type === 'object') {
    const fields = Object.entries(schema.properties ?? {})
      .map(
        ([key, value]) =>
          `${JSON.stringify(key)}${schema.required?.includes(key) ? '' : '?'}: ${toType(value)}`,
      )
      .join('; ');
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object')
      return `Record<string, ${toType(schema.additionalProperties)}>`;
    return `{ ${fields} }`;
  }
  throw new Error('Unrecognized request schema');
}
const operations = [
  ['/v1/workspace/policy', 'get', null, 'Read workspace invitation-domain policy', 'admin'],
  [
    '/v1/workspace/policy',
    'patch',
    'WorkspacePolicyPatch',
    'Update versioned invitation-domain policy',
    'admin',
  ],
  ['/health', 'get', null, 'Service health', 'public'],
  ['/ready', 'get', null, 'Read-only schema and owner readiness', 'public'],
  ['/auth/login', 'post', 'Login', 'Create an HttpOnly session', 'public'],
  ['/auth/logout', 'post', null, 'Revoke current session', 'read'],
  ['/auth/accept-invite', 'post', 'AcceptInvite', 'Accept a single-use invitation', 'public'],
  ['/v1/me', 'get', null, 'Current user and permissions', 'read'],
  ['/v1/catalog', 'get', null, 'Workspace, people, teams, workflows, labels and modules', 'read'],
  ['/v1/teams', 'post', 'Team', 'Create a team and its default workflow', 'admin'],
  ['/v1/statuses', 'post', 'Status', 'Create a team workflow state', 'admin'],
  ['/v1/labels', 'post', 'Label', 'Create a workspace label', 'write'],
  ['/v1/invitations', 'post', 'Invite', 'Create a single-use invitation link', 'admin'],
  [
    '/v1/members/{id}',
    'patch',
    'MemberRole',
    'Change member role with last-owner protection',
    'admin',
  ],
  ['/v1/tokens', 'get', null, 'List own personal API tokens without secrets', 'read'],
  ['/v1/tokens', 'post', 'Token', 'Create an expiring scoped token; secret returned once', 'read'],
  ['/v1/tokens/{id}', 'delete', null, 'Revoke own API token', 'read'],
  ['/v1/issues', 'get', null, 'List issues with filters and signed keyset pagination', 'read'],
  [
    '/v1/issues',
    'post',
    'IssueCreate',
    'Create issue or epic with optional idempotency key',
    'write',
  ],
  [
    '/v1/issues/{id}',
    'get',
    null,
    'Get issue, comments, history, children, files and relationships',
    'read',
  ],
  [
    '/v1/issues/{id}',
    'patch',
    'IssuePatch',
    'Update, archive, soft-delete or restore using expected version',
    'write',
  ],
  ['/v1/issues/bulk', 'patch', 'IssueBulk', 'Atomically update up to 100 issues', 'write'],
  [
    '/v1/issues/{id}/comments',
    'post',
    'Comment',
    'Add Markdown comment and subscribe author',
    'write',
  ],
  [
    '/v1/comments/{id}',
    'patch',
    'CommentPatch',
    'Edit comment with ownership and version checks',
    'write',
  ],
  [
    '/v1/issues/{id}/relations',
    'post',
    'Relation',
    'Add directed or symmetric relationship; prevent cycles',
    'write',
  ],
  ['/v1/relations/{id}', 'delete', null, 'Remove an issue relationship', 'write'],
  ['/v1/issues/{id}/subscription', 'post', null, 'Subscribe current user', 'read'],
  ['/v1/issues/{id}/subscription', 'delete', null, 'Unsubscribe current user', 'read'],
  ['/v1/projects', 'get', null, 'List projects and completion counts', 'read'],
  ['/v1/projects', 'post', 'ProjectCreate', 'Create cross-team project', 'write'],
  [
    '/v1/projects/{id}',
    'patch',
    'ProjectPatch',
    'Update project with optimistic concurrency',
    'write',
  ],
  ['/v1/milestones', 'get', null, 'List project milestones', 'read'],
  ['/v1/milestones', 'post', 'Milestone', 'Create project milestone', 'write'],
  ['/v1/cycles', 'get', null, 'List team cycles', 'read'],
  ['/v1/cycles/{id}', 'patch', 'CyclePatch', 'Update cycle using expected version', 'write'],
  ['/v1/cycles', 'post', 'Cycle', 'Create time-boxed cycle', 'write'],
  ['/v1/views', 'get', null, 'List own and shared saved views', 'read'],
  ['/v1/views', 'post', 'View', 'Create a private or shared saved filter', 'write'],
  ['/v1/views/{id}', 'delete', null, 'Delete own saved view; admin override allowed', 'write'],
  ['/v1/notifications', 'get', null, 'List current user inbox', 'read'],
  ['/v1/notifications/{id}/read', 'post', null, 'Mark own notification read', 'read'],
  [
    '/v1/modules/{id}',
    'patch',
    'Module',
    'Enable or disable a module without deleting data',
    'admin',
  ],
  [
    '/v1/issues/{id}/attachments',
    'post',
    'Attachment',
    'Reserve private upload within workspace quota',
    'write',
  ],
  [
    '/v1/attachments/{id}/content',
    'put',
    'binary',
    'Upload reserved bytes, validate size and signature; maximum 3 MiB',
    'write',
  ],
  [
    '/v1/attachments/{id}/content',
    'get',
    null,
    'Download authorized private object or redirect to 60-second signed URL',
    'read',
  ],
  [
    '/v1/attachments/{id}',
    'delete',
    null,
    'Soft-remove attachment; object retained for explicit cleanup',
    'write',
  ],
  [
    '/v1/integrations',
    'get',
    null,
    'View non-secret connection readiness and queue summaries',
    'admin',
  ],
  [
    '/v1/integrations/github',
    'patch',
    'GitHubConfig',
    'Configure GitHub workflow mapping',
    'admin',
  ],
  [
    '/v1/integrations/slack',
    'patch',
    'SlackConfig',
    'Configure Slack team and explicit user mappings',
    'admin',
  ],
  [
    '/v1/issues/{id}/export/github',
    'post',
    null,
    'Queue an explicit outbound GitHub issue export',
    'admin',
  ],
  [
    '/webhooks/github',
    'post',
    'webhook',
    'Receive HMAC-verified GitHub events into durable inbox',
    'webhook',
  ],
  [
    '/webhooks/slack',
    'post',
    'slack',
    'Receive signed Slack command or message shortcut',
    'webhook',
  ],
  [
    '/internal/jobs',
    'post',
    null,
    'Process a bounded batch using CRON_SECRET, not a personal API token',
    'worker',
  ],
];
export function generateOpenAPI() {
  const paths = {};
  for (const [path, method, schema, summary, scope] of operations) {
    const operation = {
      summary,
      operationId: method + path.replace(/[^a-z0-9]/gi, '_'),
      'x-required-scope': scope,
      tags: [path.split('/')[path.startsWith('/v1/') ? 2 : 1]],
      responses: {
        200: {
          description:
            'Successful operation. Creates usually return 201; queued GitHub export and webhook requests return 202.',
        },
        400: { description: 'Malformed request' },
        401: { description: 'Unauthenticated' },
        403: { description: 'Insufficient scope, role, or CSRF protection' },
        404: { description: 'Resource not found in this workspace' },
        409: {
          description:
            'Version conflict (error.details.current), dependency conflict, or duplicate',
        },
        422: { description: 'Validation error' },
        429: { description: 'Rate limit' },
        503: { description: 'Provider or production configuration missing' },
      },
    };
    if (path === '/ready') {
      operation.responses[200] = {
        description: 'Exact schema and workspace owner are ready',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['status'],
              additionalProperties: false,
              properties: { status: { const: 'ready' } },
            },
          },
        },
      };
      operation.responses[503] = {
        description:
          'Database, migrations, or first owner still require setup; no initialization is performed',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['status', 'code'],
              additionalProperties: false,
              properties: {
                status: { const: 'not_ready' },
                code: {
                  enum: [
                    'MIGRATION_REQUIRED',
                    'OWNER_SETUP_REQUIRED',
                    'DATABASE_SETUP_REQUIRED',
                    'PRODUCTION_CONFIG_REQUIRED',
                  ],
                },
              },
            },
          },
        },
      };
    }
    if (['public', 'webhook'].includes(scope)) operation.security = [];
    if (scope === 'worker') operation.security = [{ workerSecret: [] }];
    operation.parameters = [];
    if (path.includes('{id}'))
      operation.parameters.push({
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: path.startsWith('/v1/issues/')
          ? 'Issue UUID or human-readable key, e.g. TKT-42'
          : 'Resource identifier',
      });
    if (path === '/v1/issues' && method === 'get')
      for (const [name, schema] of Object.entries({
        ...filters.properties,
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
        cursor: { type: 'string' },
      }))
        operation.parameters.push({ name, in: 'query', schema });
    if (path === '/v1/issues' && method === 'post')
      operation.parameters.push({
        name: 'Idempotency-Key',
        in: 'header',
        schema: { type: 'string', maxLength: 160 },
        description: 'Optional stable key. Reusing with a different body returns 409.',
      });
    if (schema) {
      const contentType =
        schema === 'binary'
          ? 'application/octet-stream'
          : schema === 'slack'
            ? 'application/x-www-form-urlencoded'
            : 'application/json';
      operation.requestBody = {
        required: true,
        content: {
          [contentType]: {
            schema: ['binary', 'slack', 'webhook'].includes(schema)
              ? { type: 'string', ...(schema === 'binary' ? { format: 'binary' } : {}) }
              : { $ref: '#/components/schemas/' + schema },
          },
        },
      };
    }
    if (schema === 'binary')
      operation.responses['413'] = {
        description: 'Maximum 3 MiB; reservation byte count must match',
      };
    if (method === 'post' && !['/auth/login', '/auth/logout'].includes(path))
      operation.responses['201'] = { description: 'Created' };
    paths[path] ??= {};
    paths[path][method] = operation;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: PRODUCT_NAME + ' API',
      version: PRODUCT_VERSION,
      description:
        'Modular workspace-scoped issue tracker. JSON snake_case fields, UUID identifiers, date-only YYYY-MM-DD values, ISO UTC timestamps. PATCH issue/project/comment requires expected version. Cookie mutations require X-Tickets-CSRF: 1 and a matching Origin when provided. Personal tokens use Authorization: Bearer. All endpoints are private except health, readiness, OpenAPI, login, invitation acceptance and signature-verified webhook receivers. Errors use {error:{code,message,details?,request_id}}. This API is not wire-compatible with Linear GraphQL.',
    },
    servers: [{ url: '/api' }],
    security: [{ sessionCookie: [] }, { bearer: [] }],
    paths,
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'tickets_session' },
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'Personal API token' },
        workerSecret: { type: 'http', scheme: 'bearer', bearerFormat: 'CRON_SECRET' },
      },
      schemas,
    },
  };
}
export function outputs() {
  return {
    'docs/openapi.json': JSON.stringify(generateOpenAPI(), null, 2) + '\n',
    'packages/contracts/request-types.ts':
      '// Generated from schemas.mjs. Run bun run api:generate.\n' +
      Object.entries(schemas)
        .map(([name, schema]) => `export type ${name} = ${toType(schema)};`)
        .join('\n') +
      '\n',
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url)),
    check = process.argv.includes('--check');
  for (const [path, content] of Object.entries(outputs())) {
    const file = resolve(root, path);
    if (check) {
      if ((await readFile(file, 'utf8').catch(() => null)) !== content)
        throw new Error('Generated API files are stale: ' + path);
    } else {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content);
    }
  }
  console.log(
    check ? 'API contracts are up to date.' : 'Generated OpenAPI and TypeScript request contracts.',
  );
}
