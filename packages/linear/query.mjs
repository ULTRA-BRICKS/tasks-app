import { createHmac, timingSafeEqual } from 'node:crypto';
import { assert, missing } from '../server/core/errors.mjs';
import { assertModule } from '../server/core/modules.mjs';

const defs = {
  Issue: {
    from: 'issues r',
    scope: 'r.workspace_id',
    time: true,
    archive: true,
    deleted: true,
    module: 'tickets',
    columns: {
      id: 'id',
      number: 'number',
      title: 'title',
      description: 'description',
      priority: 'priority',
    },
  },
  Team: {
    from: 'teams r',
    scope: 'r.workspace_id',
    columns: { id: 'id', key: 'key', name: 'name' },
  },
  User: {
    from: 'workspace_people r',
    scope: 'r.workspace_id',
    time: 'created_at',
    columns: { id: 'id', name: 'name', email: 'email' },
  },
  WorkflowState: {
    from: 'statuses r',
    scope: 'r.workspace_id',
    columns: { id: 'id', name: 'name', type: 'category' },
  },
  IssueLabel: { from: 'labels r', scope: 'r.workspace_id', columns: { id: 'id', name: 'name' } },
  Project: {
    from: 'projects r',
    scope: 'r.workspace_id',
    time: true,
    archive: true,
    module: 'planning',
    columns: { id: 'id', name: 'name' },
  },
  ProjectMilestone: {
    from: 'milestones r',
    scope: 'r.workspace_id',
    module: 'planning',
    columns: { id: 'id', name: 'name' },
  },
  Comment: {
    from: 'comments r',
    scope: 'r.workspace_id',
    time: true,
    columns: { id: 'id', body: 'body' },
  },
  IssueRelation: { from: 'relations r', scope: 'r.workspace_id', columns: { id: 'id' } },
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && uuid.test(v);
const stable = (v) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, x[k]]),
        )
      : x,
  );
export function compileFilter(type, filter, ctx, alias = 'r', counter = { n: 0 }) {
  if (!filter) return { sql: '1=1', args: [] };
  const parts = [],
    args = [];
  const add = (sql, values = []) => {
    parts.push(sql);
    args.push(...values);
  };
  const compare = (col, ops) => {
    for (let [op, v] of Object.entries(ops ?? {})) {
      if (v === null) continue;
      if (op === 'null') {
        add(`${col} IS ${v ? '' : 'NOT '}NULL`);
        continue;
      }
      if (['in', 'nin'].includes(op)) {
        assert(v.length <= 100, 422, 'FILTER_LIMIT', 'At most 100 filter values');
        add(
          v.length
            ? `${col} ${op === 'nin' ? 'NOT ' : ''}IN (${v.map(() => '?').join(',')})`
            : op === 'in'
              ? '1=0'
              : '1=1',
          v,
        );
        continue;
      }
      if (op === 'contains' || op === 'containsIgnoreCase') {
        const c = op.endsWith('IgnoreCase') ? `lower(${col})` : col;
        const value = op.endsWith('IgnoreCase') ? v.toLowerCase() : v;
        add(ctx.tx.dialect === 'postgres' ? `strpos(${c},?)>0` : `instr(${c},?)>0`, [value]);
        continue;
      }
      if (op === 'eqIgnoreCase' || op === 'neqIgnoreCase') {
        add(`lower(${col}) ${op === 'eqIgnoreCase' ? '=' : '<>'} lower(?)`, [v]);
        continue;
      }
      const operators = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
      assert(operators[op], 422, 'INVALID_FILTER', 'Unsupported filter operator');
      add(`${col} ${operators[op]} ?`, [v]);
    }
  };
  for (const [key, value] of Object.entries(filter)) {
    if (value === null) continue;
    if (key === 'and' || key === 'or') {
      assert(value.length <= 50, 422, 'FILTER_LIMIT', 'At most 50 compound filters');
      const sub = value.map((f) => compileFilter(type, f, ctx, alias, counter));
      add(
        sub.length
          ? '(' + sub.map((f) => `(${f.sql})`).join(key === 'and' ? ' AND ' : ' OR ') + ')'
          : key === 'and'
            ? '1=1'
            : '1=0',
        sub.flatMap((f) => f.args),
      );
      continue;
    }
    if (key === 'null') {
      add(`${alias}.id IS ${value ? '' : 'NOT '}NULL`);
      continue;
    }
    if (type === 'User' && key === 'isMe') {
      for (const [op, v] of Object.entries(value)) {
        if (v == null) continue;
        add(`${alias}.id ${(op === 'eq') === v ? '=' : '<>'} ?`, [ctx.actor.id]);
      }
      continue;
    }
    const relations = {
      team: ['Team', 'teams', 'team_id'],
      state: ['WorkflowState', 'statuses', 'status_id'],
      project: ['Project', 'projects', 'project_id'],
      assignee: ['User', 'workspace_people', 'assignee_id'],
      creator: ['User', 'workspace_people', 'creator_id'],
    };
    if (type === 'Issue' && relations[key]) {
      const [related, table, fk] = relations[key];
      const reference =
        key === 'assignee'
          ? `COALESCE(${alias}.assignee_id,${alias}.assignee_source_id)`
          : key === 'creator'
            ? `COALESCE(${alias}.creator_source_id,${alias}.creator_id)`
            : `${alias}.${fk}`;
      const nullable = (f) => {
        const clauses = [],
          params = [];
        for (const [k, v] of Object.entries(f)) {
          if (v == null) continue;
          if (k === 'null') {
            clauses.push(`${reference} IS ${v ? '' : 'NOT '}NULL`);
            continue;
          }
          if (k === 'and' || k === 'or') {
            assert(v.length <= 50, 422, 'FILTER_LIMIT', 'At most 50 compound filters');
            const children = v.map(nullable);
            clauses.push(
              children.length
                ? '(' + children.map((x) => x.sql).join(k === 'and' ? ' AND ' : ' OR ') + ')'
                : k === 'and'
                  ? '1=1'
                  : '1=0',
            );
            params.push(...children.flatMap((x) => x.args));
            continue;
          }
          const a = 'f' + ++counter.n,
            sub = compileFilter(related, { [k]: v }, ctx, a, counter);
          clauses.push(
            `EXISTS(SELECT 1 FROM ${table} ${a} WHERE ${a}.id=${reference} AND ${a}.workspace_id=${alias}.workspace_id AND (${sub.sql}))`,
          );
          params.push(...sub.args);
        }
        return { sql: clauses.length ? '(' + clauses.join(' AND ') + ')' : '1=1', args: params };
      };
      const sub = nullable(value);
      add(sub.sql, sub.args);
      continue;
    }
    if (type === 'Issue' && key === 'labels') {
      const labelPart = (f) => {
        const a = 'f' + ++counter.n,
          sub = compileFilter('IssueLabel', f, ctx, a, counter);
        return {
          sql: `SELECT 1 FROM issue_labels il JOIN labels ${a} ON ${a}.id=il.label_id WHERE il.workspace_id=${alias}.workspace_id AND il.issue_id=${alias}.id`,
          sub,
        };
      };
      const walk = (f) => {
        const clauses = [],
          params = [];
        const direct = Object.fromEntries(
          Object.entries(f).filter(
            ([k, v]) => !['some', 'every', 'and', 'or', 'null'].includes(k) && v != null,
          ),
        );
        if (Object.keys(direct).length) {
          const p = labelPart(direct);
          clauses.push(`EXISTS(${p.sql} AND (${p.sub.sql}))`);
          params.push(...p.sub.args);
        }
        for (const [k, v] of Object.entries(f)) {
          if (v == null || k in direct) continue;
          if (k === 'and' || k === 'or') {
            assert(v.length <= 50, 422, 'FILTER_LIMIT', 'At most 50 compound filters');
            const children = v.map(walk);
            clauses.push(
              children.length
                ? '(' + children.map((s) => s.sql).join(k === 'and' ? ' AND ' : ' OR ') + ')'
                : k === 'and'
                  ? '1=1'
                  : '1=0',
            );
            params.push(...children.flatMap((s) => s.args));
            continue;
          }
          const p = labelPart(['some', 'every'].includes(k) ? v : k === 'null' ? {} : { [k]: v });
          clauses.push(
            `${k === 'every' || (k === 'null' && v) ? 'NOT ' : ''}EXISTS(${p.sql} AND ${k === 'every' ? 'NOT ' : ''}(${p.sub.sql}))`,
          );
          params.push(...p.sub.args);
        }
        return { sql: clauses.length ? clauses.join(' AND ') : '1=1', args: params };
      };
      const result = walk(value);
      add(result.sql, result.args);
      continue;
    }
    const column = defs[type].columns[key];
    assert(column, 422, 'INVALID_FILTER', 'Unsupported filter field');
    if (type === 'Issue' && key === 'id') {
      // Linear's IssueIDComparator also accepts human-readable identifiers.
      for (const [op, v] of Object.entries(value)) {
        if (v == null) continue;
        const vs = Array.isArray(v) ? v : [v];
        assert(vs.length <= 100, 422, 'FILTER_LIMIT', 'At most 100 filter values');
        const clauses = vs.map((x) => `${alias}.${isUuid(x) ? 'id' : 'key'} = ?`);
        add(
          clauses.length
            ? `${['neq', 'nin'].includes(op) ? 'NOT ' : ''}(${clauses.join(' OR ')})`
            : op === 'in'
              ? '1=0'
              : '1=1',
          vs,
        );
      }
    } else
      compare(
        type === 'WorkflowState' && key === 'type'
          ? `COALESCE(${alias}.source_type,${alias}.category)`
          : `${alias}.${column}`,
        value,
      );
  }
  return { sql: parts.length ? '(' + parts.join(' AND ') + ')' : '1=1', args };
}
function liveReferences(type) {
  const columns =
    type === 'Comment' ? ['issue_id'] : type === 'IssueRelation' ? ['source_id', 'target_id'] : [];
  return columns
    .map(
      (col) =>
        ` AND EXISTS(SELECT 1 FROM issues live WHERE live.workspace_id=r.workspace_id AND live.id=r.${col} AND live.deleted_at IS NULL)`,
    )
    .join('');
}
export async function getRecord(type, id, ctx) {
  if (type === 'Issue') return ctx.tickets.getIssue(ctx.tx, ctx.actor, id);
  const d = defs[type];
  if (d.module) await assertModule(ctx.tx, ctx.actor.workspace_id, d.module);
  const row = await ctx.tx.one(
    `SELECT r.* FROM ${d.from} WHERE ${d.scope}=? AND r.id=? ${liveReferences(type)}`,
    [ctx.actor.workspace_id, id],
  );
  if (!row) throw missing(type);
  return row;
}
export async function connection(
  type,
  input,
  ctx,
  extra = { sql: '1=1', args: [], scope: 'root' },
) {
  const d = defs[type];
  if (d.module) await assertModule(ctx.tx, ctx.actor.workspace_id, d.module);
  const args = input ?? {},
    back = args.last != null,
    limit = back ? args.last : (args.first ?? 50);
  assert(
    !(back && args.first != null) && Number.isInteger(limit) && limit >= 0 && limit <= 100,
    422,
    'PAGINATION',
    'Use first or last, between 0 and 100',
  );
  const order =
    d.time === true ? (args.orderBy === 'updatedAt' ? 'updated_at' : 'created_at') : d.time || 'id';
  const filter = compileFilter(type, args.filter, ctx);
  const where = [`${d.scope}=?`, extra.sql, filter.sql];
  const values = [ctx.actor.workspace_id, ...extra.args, ...filter.args];
  if (d.deleted) where.push('r.deleted_at IS NULL');
  if (d.archive && !args.includeArchived) where.push('r.archived_at IS NULL');
  const live = liveReferences(type);
  if (live) where.push(live.slice(4));
  const scope = stable({
    type,
    workspace: ctx.actor.workspace_id,
    parent: extra.scope,
    filter: args.filter ?? null,
    query: args.query ?? null,
    order,
    archived: !!args.includeArchived,
  });
  const mac = (s) => createHmac('sha256', ctx.secret).update(s).digest('base64url');
  const encode = (row) => {
    const s = Buffer.from(JSON.stringify({ scope, id: row.id, value: row[order] })).toString(
      'base64url',
    );
    return s + '.' + mac(s);
  };
  const decode = (cursor) => {
    assert(typeof cursor === 'string' && cursor.length < 16000, 422, 'CURSOR', 'Invalid cursor');
    const [s, signature, ...other] = cursor.split('.');
    const a = Buffer.from(signature ?? ''),
      b = Buffer.from(mac(s));
    assert(
      !other.length && a.length === b.length && timingSafeEqual(a, b),
      422,
      'CURSOR',
      'Invalid cursor',
    );
    let row;
    try {
      row = JSON.parse(Buffer.from(s, 'base64url').toString());
    } catch {
      throw missing('Cursor');
    }
    assert(
      row.scope === scope && typeof row.id === 'string' && typeof row.value === 'string',
      422,
      'CURSOR',
      'Cursor belongs to another query',
    );
    return row;
  };
  const bounds = [],
    boundValues = [];
  const comparison = (row, sign) => ({
    sql: `(r.${order} ${sign} ? OR (r.${order}=? AND r.id ${sign} ?))`,
    args: [row.value, row.value, row.id],
  });
  for (const [key, sign] of [
    ['after', '<'],
    ['before', '>'],
  ])
    if (args[key] != null) {
      const c = comparison(decode(args[key]), sign);
      bounds.push(c.sql);
      boundValues.push(...c.args);
    }
  const base = `FROM ${d.from} WHERE ${where.join(' AND ')}`;
  let rows = await ctx.tx.all(
    `SELECT r.* ${base}${bounds.length ? ' AND ' + bounds.join(' AND ') : ''} ORDER BY r.${order} ${back ? 'ASC' : 'DESC'},r.id ${back ? 'ASC' : 'DESC'} LIMIT ?`,
    [...values, ...boundValues, limit + 1],
  );
  const more = rows.length > limit;
  rows = rows.slice(0, limit);
  if (back) rows.reverse();
  const exists = async (row, sign) => {
    if (!row) return false;
    const c = comparison({ id: row.id, value: row[order] }, sign);
    return !!(await ctx.tx.one(`SELECT r.id ${base} AND ${c.sql} LIMIT 1`, [...values, ...c.args]));
  };
  return {
    nodes: rows,
    edges: rows.map((node) => ({ node, cursor: encode(node) })),
    pageInfo: {
      startCursor: rows.length ? encode(rows[0]) : null,
      endCursor: rows.length ? encode(rows.at(-1)) : null,
      hasNextPage: back ? await exists(rows.at(-1), '<') : more,
      hasPreviousPage: back ? more : await exists(rows[0], '>'),
    },
  };
}
