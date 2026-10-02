import { applicationOrigin, isAllowedOrigin } from '../config/development.mjs';
import {
  buildSchema,
  parse,
  validate as validateGraphQL,
  execute,
  getOperationAST,
  GraphQLError,
  Kind,
  getNamedType,
} from 'graphql';
import { readFileSync } from 'node:fs';
import { AppError, assert, requirePermission, missing } from '../server/core/errors.mjs';
import { authenticate } from '../server/modules/identity/service.mjs';
import * as tickets from '../server/modules/tickets/service.mjs';
import * as planning from '../server/modules/planning/service.mjs';
import { schemas } from '../contracts/schemas.mjs';
import { validate, validDate } from '../contracts/validate.mjs';
import { connection, getRecord } from './query.mjs';
let schema;
export function getLinearSchema() {
  if (schema) return schema;
  schema = buildSchema(readFileSync(new URL('./schema.graphql', import.meta.url), 'utf8'));
  const date = schema.getType('TimelessDate');
  if (date) {
    const coerce = (v) => {
      assert(validDate(v), 422, 'INVALID_DATE', 'Use a valid YYYY-MM-DD date');
      return v;
    };
    date.parseValue = coerce;
    date.serialize = coerce;
    date.parseLiteral = (n) => coerce(n.kind === Kind.STRING ? n.value : null);
  }
  return schema;
}
const issueMap = {
  teamId: 'team_id',
  title: 'title',
  description: 'description',
  priority: 'priority',
  stateId: 'status_id',
  assigneeId: 'assignee_id',
  labelIds: 'label_ids',
  projectId: 'project_id',
  projectMilestoneId: 'milestone_id',
  parentId: 'parent_id',
  dueDate: 'due_date',
  estimate: 'estimate',
  sortOrder: 'position',
};
const projectMap = {
  name: 'name',
  description: 'description',
  teamIds: 'team_ids',
  leadId: 'lead_id',
  startDate: 'start_date',
  targetDate: 'target_date',
};
const mapInput = (v, map) =>
  Object.fromEntries(
    Object.entries(v)
      .filter(([k]) => map[k])
      .map(([k, x]) => [map[k], x === null && k === 'description' ? '' : x]),
  );
const extra = (sql, args, scope) => ({ sql, args, scope });
const scalarFields = {
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  archivedAt: 'archived_at',
  identifier: 'key',
  dueDate: 'due_date',
  sortOrder: 'position',
  startDate: 'start_date',
  targetDate: 'target_date',
  avatarUrl: 'avatar_url',
  urlKey: 'slug',
};
const priorities = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];
function errorShape(error) {
  const original = error.originalError ?? error;
  const known =
    original instanceof AppError || (error instanceof GraphQLError && !error.originalError);
  const status = original.status;
  return {
    message: known ? error.message : 'Request could not be completed',
    ...(error.locations ? { locations: error.locations } : {}),
    ...(error.path ? { path: error.path } : {}),
    extensions: {
      type:
        status === 401
          ? 'authentication error'
          : status === 403
            ? 'forbidden'
            : known
              ? 'user error'
              : 'internal error',
      code:
        original.code ??
        error.extensions?.code ??
        (known ? 'GRAPHQL_VALIDATION_FAILED' : 'INTERNAL_SERVER_ERROR'),
      userError: known,
    },
  };
}
function complexity(doc, operation, variables) {
  const fragments = new Map(
    doc.definitions
      .filter((x) => x.kind === Kind.FRAGMENT_DEFINITION)
      .map((x) => [x.name.value, x]),
  );
  let count = 0;
  const types = getLinearSchema();
  function walk(set, depth, multiplier, parentType) {
    assert(depth <= 12, 400, 'QUERY_COMPLEXITY', 'Query nesting exceeds 12 levels');
    for (const node of set?.selections ?? []) {
      count += multiplier;
      assert(count <= 20000, 400, 'QUERY_COMPLEXITY', 'Query exceeds the operation budget');
      if (node.kind === Kind.FRAGMENT_SPREAD) {
        const f = fragments.get(node.name.value);
        walk(f.selectionSet, depth + 1, multiplier, f.typeCondition.name.value);
        continue;
      }
      if (node.kind === Kind.INLINE_FRAGMENT) {
        walk(
          node.selectionSet,
          depth + 1,
          multiplier,
          node.typeCondition?.name.value ?? parentType,
        );
        continue;
      }
      const field = types.getType(parentType)?.getFields?.()[node.name.value];
      const child = field ? getNamedType(field.type).name : null;
      let size = 1;
      if (child?.endsWith('Connection')) {
        const arg = node.arguments?.find(
          (a) => a.name.value === 'first' || a.name.value === 'last',
        );
        // Count missing variable defaults conservatively. The resolver independently enforces the page cap.
        const n =
          arg?.value.kind === Kind.VARIABLE
            ? (variables[arg.value.name.value] ?? 100)
            : arg
              ? Number(arg.value.value)
              : 50;
        size = Math.min(101, Math.max(1, n ?? 100));
      }
      walk(node.selectionSet, depth + 1, multiplier * size, child);
    }
  }
  walk(operation.selectionSet, 0, 1, operation.operation === 'mutation' ? 'Mutation' : 'Query');
  // Input filters can be recursive even when the selection set is small.
  function input(v, d = 0) {
    assert(d <= 20, 400, 'QUERY_COMPLEXITY', 'Input nesting exceeds 20 levels');
    if (v && typeof v === 'object')
      for (const x of Object.values(v)) {
        count++;
        assert(count <= 25000, 400, 'QUERY_COMPLEXITY', 'Input exceeds the operation budget');
        input(x, d + 1);
      }
  }
  input(variables);
}
async function mutate(name, args, c) {
  const { tx, actor } = c;
  requirePermission(actor, 'write');
  if (name === 'issueCreate') {
    const input = mapInput(args.input, issueMap);
    if (input.label_ids === null) input.label_ids = [];
    const issue = await tickets.createIssue(tx, actor, validate(input, schemas.IssueCreate));
    return { success: true, issue };
  }
  if (
    [
      'issueUpdate',
      'issueArchive',
      'issueUnarchive',
      'issueDelete',
      'issueAddLabel',
      'issueRemoveLabel',
    ].includes(name)
  ) {
    const current = await tickets.getIssue(tx, actor, args.id);
    let patch = { version: current.version };
    if (name === 'issueUpdate') {
      patch = { ...patch, ...mapInput(args.input, issueMap) };
      if (patch.label_ids === null) patch.label_ids = [];
      if (args.input.addedLabelIds || args.input.removedLabelIds) {
        const labels = new Set(patch.label_ids ?? current.label_ids);
        for (const x of args.input.addedLabelIds ?? []) labels.add(x);
        for (const x of args.input.removedLabelIds ?? []) labels.delete(x);
        patch.label_ids = [...labels];
      }
    } else if (name === 'issueDelete') patch.deleted = true;
    else if (name === 'issueArchive' || name === 'issueUnarchive')
      patch.archived = name === 'issueArchive';
    else
      patch.label_ids =
        name === 'issueAddLabel'
          ? [...new Set([...current.label_ids, args.labelId])]
          : current.label_ids.filter((x) => x !== args.labelId);
    const issue = await tickets.updateIssue(
      tx,
      actor,
      current.id,
      validate(patch, schemas.IssuePatch),
    );
    return { success: true, issue, entity: issue };
  }
  if (name === 'commentCreate') {
    const input = validate({ body: args.input.body }, schemas.Comment);
    assert(args.input.issueId, 422, 'ISSUE_REQUIRED', 'Issue comments require issueId');
    return {
      success: true,
      comment: await tickets.addComment(tx, actor, args.input.issueId, input.body),
    };
  }
  if (name === 'issueRelationCreate') {
    const input = args.input;
    const target = await tickets.getIssue(tx, actor, input.relatedIssueId);
    return {
      success: true,
      issueRelation: await tickets.addRelation(tx, actor, input.issueId, {
        target_id: target.id,
        type: input.type === 'duplicate' ? 'duplicates' : input.type,
      }),
    };
  }
  if (name === 'issueRelationDelete') {
    const r = await getRecord('IssueRelation', args.id, c);
    const issue = await tickets.getIssue(tx, actor, r.source_id);
    await tx.exec('DELETE FROM relations WHERE workspace_id=? AND id=?', [
      actor.workspace_id,
      r.id,
    ]);
    await tickets.recordActivity(tx, actor, issue, 'unlinked', { relation_id: r.id });
    return { success: true };
  }
  if (name === 'projectCreate')
    return {
      success: true,
      project: await planning.createProject(
        tx,
        actor,
        validate(mapInput(args.input, projectMap), schemas.ProjectCreate),
      ),
    };
  if (name === 'projectUpdate') {
    const current = await getRecord('Project', args.id, c);
    return {
      success: true,
      project: await planning.updateProject(
        tx,
        actor,
        args.id,
        validate(
          { ...mapInput(args.input, projectMap), version: current.version },
          schemas.ProjectPatch,
        ),
      ),
    };
  }
  if (name === 'projectMilestoneCreate')
    return {
      success: true,
      projectMilestone: await planning.createMilestone(
        tx,
        actor,
        validate(
          {
            name: args.input.name,
            project_id: args.input.projectId,
            ...(Object.hasOwn(args.input, 'targetDate')
              ? { target_date: args.input.targetDate }
              : {}),
          },
          schemas.Milestone,
        ),
      ),
    };
  throw missing('Mutation');
}
const rootTypes = {
  issue: 'Issue',
  team: 'Team',
  user: 'User',
  workflowState: 'WorkflowState',
  issueLabel: 'IssueLabel',
  project: 'Project',
  projectMilestone: 'ProjectMilestone',
  comment: 'Comment',
  issueRelation: 'IssueRelation',
};
async function resolve(source, args, c, info) {
  const { fieldName: name, parentType } = info,
    type = parentType.name;
  if (type === 'Mutation') {
    // GraphQL root mutations are serial. A savepoint prevents one failure from poisoning subsequent fields.
    await c.tx.script('SAVEPOINT linear_mutation');
    try {
      const r = await mutate(name, args, c);
      await c.tx.script('RELEASE SAVEPOINT linear_mutation');
      return r;
    } catch (e) {
      await c.tx.script('ROLLBACK TO SAVEPOINT linear_mutation');
      await c.tx.script('RELEASE SAVEPOINT linear_mutation');
      throw e;
    }
  }
  const list = (t, a = args, ex) => connection(t, a, c, ex);
  const get = (t, id) => (id ? getRecord(t, id, c) : null);
  const organization = () =>
    c.tx.one('SELECT * FROM workspaces WHERE id=?', [c.actor.workspace_id]);
  if (type === 'Query') {
    if (name === 'viewer') return get('User', c.actor.id);
    if (name === 'organization') return organization();
    if (name === 'issuePriorityValues')
      return priorities.map((label, priority) => ({ label, priority }));
    if (rootTypes[name]) {
      assert(args.id, 422, 'ID_REQUIRED', 'An id is required');
      return get(rootTypes[name], args.id);
    }
    if (name === 'issueSearch') {
      const f = args.query
        ? { or: [{ title: { containsIgnoreCase: args.query } }, { id: { eq: args.query } }] }
        : null;
      return list('Issue', { ...args, filter: f ? { and: [args.filter ?? {}, f] } : args.filter });
    }
    const key = name === 'issues' ? 'issue' : name.slice(0, -1);
    if (rootTypes[key]) return list(rootTypes[key]);
  }
  if (type === 'Issue') {
    const refs = {
      assignee: ['User', 'assignee_id'],
      creator: ['User', 'creator_id'],
      team: ['Team', 'team_id'],
      state: ['WorkflowState', 'status_id'],
      project: ['Project', 'project_id'],
      projectMilestone: ['ProjectMilestone', 'milestone_id'],
      parent: ['Issue', 'parent_id'],
    };
    if (refs[name]) return get(...[refs[name][0], source[refs[name][1]]]);
    if (name === 'priorityLabel') return priorities[source.priority];
    if (name === 'url') return c.origin + '/issues/' + encodeURIComponent(source.id);
    if (name === 'labelIds')
      return (
        await c.tx.all('SELECT label_id FROM issue_labels WHERE workspace_id=? AND issue_id=?', [
          c.actor.workspace_id,
          source.id,
        ])
      ).map((x) => x.label_id);
    if (name === 'labels')
      return list(
        'IssueLabel',
        args,
        extra(
          'EXISTS(SELECT 1 FROM issue_labels il WHERE il.label_id=r.id AND il.workspace_id=? AND il.issue_id=?)',
          [c.actor.workspace_id, source.id],
          'issue:' + source.id,
        ),
      );
    const children = {
      children: ['Issue', 'parent_id'],
      comments: ['Comment', 'issue_id'],
      relations: ['IssueRelation', 'source_id'],
      inverseRelations: ['IssueRelation', 'target_id'],
    };
    if (children[name])
      return list(
        children[name][0],
        args,
        extra(`r.${children[name][1]}=?`, [source.id], type + ':' + source.id + ':' + name),
      );
  }
  if (type === 'Team') {
    if (name === 'displayName') return source.name;
    if (name === 'organization') return organization();
    if (name === 'issues' || name === 'states')
      return list(
        name === 'issues' ? 'Issue' : 'WorkflowState',
        args,
        extra('r.team_id=?', [source.id], 'team:' + source.id),
      );
  }
  if (type === 'User') {
    if (name === 'displayName') return source.name;
    if (name === 'isMe') return source.id === c.actor.id;
    if (name === 'active') return true;
    if (name === 'admin') return ['admin', 'owner'].includes(source.role);
    if (name === 'owner') return source.role === 'owner';
    if (name === 'organization') return organization();
    if (name === 'assignedIssues' || name === 'createdIssues')
      return list(
        'Issue',
        args,
        extra(
          `r.${name === 'assignedIssues' ? 'assignee_id' : 'creator_id'}=?`,
          [source.id],
          'user:' + source.id + ':' + name,
        ),
      );
  }
  if (type === 'WorkflowState') {
    if (name === 'type') return source.category;
    if (name === 'team') return get('Team', source.team_id);
    if (name === 'issues')
      return list('Issue', args, extra('r.status_id=?', [source.id], 'state:' + source.id));
  }
  if (type === 'IssueLabel') {
    if (name === 'isGroup') return false;
    if (name === 'organization') return organization();
    if (name === 'issues')
      return list(
        'Issue',
        args,
        extra(
          'EXISTS(SELECT 1 FROM issue_labels il WHERE il.issue_id=r.id AND il.workspace_id=? AND il.label_id=?)',
          [c.actor.workspace_id, source.id],
          'label:' + source.id,
        ),
      );
  }
  if (type === 'Project') {
    if (name === 'lead') return get('User', source.lead_id);
    if (name === 'url') return c.origin + '/issues?project_id=' + encodeURIComponent(source.id);
    if (name === 'issues' || name === 'projectMilestones')
      return list(
        name === 'issues' ? 'Issue' : 'ProjectMilestone',
        args,
        extra('r.project_id=?', [source.id], 'project:' + source.id),
      );
    if (name === 'teams')
      return list(
        'Team',
        args,
        extra(
          'EXISTS(SELECT 1 FROM project_teams pt WHERE pt.team_id=r.id AND pt.workspace_id=? AND pt.project_id=?)',
          [c.actor.workspace_id, source.id],
          'project:' + source.id,
        ),
      );
  }
  if (type === 'ProjectMilestone' && name === 'project') return get('Project', source.project_id);
  if (type === 'Comment') {
    if (name === 'issue') return get('Issue', source.issue_id);
    if (name === 'user') return get('User', source.author_id);
    if (name === 'url') return c.origin + '/issues/' + source.issue_id + '#comment-' + source.id;
  }
  if (type === 'IssueRelation') {
    if (name === 'type') return source.type === 'duplicates' ? 'duplicate' : source.type;
    if (name === 'issue') return get('Issue', source.source_id);
    if (name === 'relatedIssue') return get('Issue', source.target_id);
  }
  return source?.[scalarFields[name] ?? name] ?? null;
}
// Limits actual SQL work as well as AST complexity, including aliases and fragments.
function budgeted(tx) {
  let queries = 0;
  const checked = { ...tx };
  for (const method of ['all', 'one', 'exec'])
    checked[method] = (...args) => {
      assert(
        ++queries <= 1000,
        422,
        'QUERY_COMPLEXITY',
        'Query exceeds the database operation budget',
      );
      return tx[method](...args);
    };
  return checked;
}
export function withLinear(app, { db, env = process.env }) {
  const secret = env.AUTH_SECRET ?? crypto.randomUUID();
  const origin = applicationOrigin(env);
  return {
    async fetch(request) {
      if (new URL(request.url).pathname.replace(/\/$/, '') !== '/graphql')
        return app.fetch(request);
      let status = 200,
        result;
      try {
        assert(request.method === 'POST', 405, 'METHOD_NOT_ALLOWED', 'Use POST for GraphQL');
        assert(
          request.headers.get('content-type')?.split(';')[0] === 'application/json',
          415,
          'JSON_REQUIRED',
          'Use application/json',
        );
        const authorization = request.headers.get('authorization');
        const bearer = authorization?.replace(/^Bearer /, '');
        if (!bearer) {
          assert(
            !request.headers.get('origin') || isAllowedOrigin(request.headers.get('origin'), env),
            403,
            'ORIGIN_NOT_ALLOWED',
            'Origin is not allowed',
          );
          assert(
            request.headers.get('x-tickets-csrf') === '1',
            403,
            'CSRF_REQUIRED',
            'A same-origin CSRF header is required',
          );
        }
        const cookie = request.headers
          .get('cookie')
          ?.split(';')
          .map((x) => x.trim())
          .find((x) => x.startsWith('tickets_session='))
          ?.slice(16);
        const reader = request.body?.getReader();
        let bytes = 0;
        const chunks = [];
        if (reader)
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.length;
            if (bytes > 65536) {
              await reader.cancel();
              throw new AppError(413, 'BODY_TOO_LARGE', 'GraphQL body exceeds 64 KiB');
            }
            chunks.push(value);
          }
        let input;
        try {
          input = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          throw new AppError(400, 'INVALID_JSON', 'Malformed JSON');
        }
        assert(
          input &&
            !Array.isArray(input) &&
            typeof input.query === 'string' &&
            (!input.operationName || typeof input.operationName === 'string') &&
            (!input.variables ||
              (typeof input.variables === 'object' && !Array.isArray(input.variables))),
          400,
          'INVALID_INPUT',
          'Expected a GraphQL query, optional variables and operationName',
        );
        const doc = parse(input.query, { maxTokens: 8000 }),
          s = getLinearSchema();
        const errors = validateGraphQL(s, doc);
        if (errors.length) result = { errors: errors.map(errorShape) };
        else {
          const op = getOperationAST(doc, input.operationName);
          assert(
            op && op.operation !== 'subscription',
            400,
            'OPERATION_REQUIRED',
            'Select a query or mutation',
          );
          complexity(doc, op, input.variables ?? {});
          result = await db.transaction(
            async (tx) => {
              const actor = await authenticate(tx, { bearer, cookie });
              requirePermission(actor, 'read');
              if (op.operation === 'mutation') await tx.lock(actor.workspace_id);
              return execute({
                schema: s,
                document: doc,
                variableValues: input.variables ?? {},
                operationName: input.operationName,
                contextValue: { tx: budgeted(tx), actor, tickets, secret, origin },
                fieldResolver: resolve,
              });
            },
            { readOnly: op.operation === 'query' },
          );
          if (result.errors) result = { ...result, errors: result.errors.map(errorShape) };
        }
      } catch (error) {
        status = error instanceof AppError ? error.status : 400;
        result = { errors: [errorShape(error)] };
      }
      return new Response(JSON.stringify(result), {
        status,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          'x-frame-options': 'DENY',
          ...(status === 405 ? { allow: 'POST' } : {}),
        },
      });
    },
  };
}
