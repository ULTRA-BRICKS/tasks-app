#!/usr/bin/env bun
import { PRODUCT_NAME, PRODUCT_VERSION } from '../config/product.mjs';
import { resolveDevelopment } from '../config/development.mjs';
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { TicketsClient } from '../sdk/index.mjs';
const usage = `${PRODUCT_NAME} CLI ${PRODUCT_VERSION}

  tasks-app auth login --url https://tickets.example.com < token.txt
  tasks-app auth logout
  tasks-app issues list [--q TEXT] [--assignee me] [--status UUID] [--json] [--all]
  tasks-app issues get TKT-1
  tasks-app issues create --team TKT --title TEXT [--body-file FILE] [--idempotency-key KEY]
  tasks-app issues update TKT-1 --version 3 [--status UUID] [--priority 1] [--due YYYY-MM-DD]
  tasks-app issues archive|restore TKT-1 --version 3
  tasks-app issues comment TKT-1 --body-file FILE
  tasks-app issues link TKT-1 --target TKT-2 --type blocks
  tasks-app projects list|create [--name TEXT] [--team TKT]
  tasks-app cycles list|create --name TEXT --team TKT --start YYYY-MM-DD --end YYYY-MM-DD
  tasks-app catalog
  tasks-app api GET /api/v1/issues [--data JSON]

Global: --url URL --json --help. Environment: TICKETS_URL, TICKETS_TOKEN.
Token login reads stdin, never a command-line argument. No automatic write retries.
Exit codes: 0 success, 1 error, 2 validation/usage, 3 authentication, 4 conflict.
`;
const types = {
  help: 'boolean',
  json: 'boolean',
  all: 'boolean',
  url: 'string',
  q: 'string',
  team: 'string',
  title: 'string',
  'body-file': 'string',
  body: 'string',
  assignee: 'string',
  status: 'string',
  priority: 'string',
  due: 'string',
  version: 'string',
  target: 'string',
  type: 'string',
  name: 'string',
  start: 'string',
  end: 'string',
  data: 'string',
  'idempotency-key': 'string',
};
const dir = process.env.TICKETS_CONFIG_DIR || join(homedir(), '.config', 'tickets-app'),
  configPath = join(dir, 'config.json');
async function load() {
  try {
    return JSON.parse(await readFile(configPath, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error('Cannot read CLI configuration');
  }
}
async function body(o) {
  return o['body-file'] ? readFile(o['body-file'], 'utf8') : (o.body ?? '');
}
function required(v, name) {
  if (v === undefined || v === '')
    throw Object.assign(new Error(`${name} is required`), { status: 422 });
  return v;
}
function terminal(v) {
  // oxlint-disable-next-line no-control-regex -- Intentionally remove untrusted terminal/path control characters.
  return String(v ?? '').replace(/[\x00-\x1f\x7f\x9b]/g, ' ');
}
function print(v, json) {
  if (json) {
    console.log(JSON.stringify(v, null, 2));
    return;
  }
  const rows = Array.isArray(v) ? v : v?.data;
  if (rows) {
    for (const r of rows)
      console.log(
        [r.key ?? r.id, r.title ?? r.name, r.status_name ?? r.status ?? '']
          .map(terminal)
          .join('\t'),
      );
    if (v.next_cursor) console.error('More results available; pass --all.');
  } else console.log(JSON.stringify(v, null, 2));
}
async function main() {
  const { values: o, positionals: p } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: Object.fromEntries(Object.entries(types).map(([key, type]) => [key, { type }])),
  });
  if (o.help || !p.length) {
    console.log(usage);
    return;
  }
  const config = await load(),
    url =
      o.url || process.env.TICKETS_URL || config.url || resolveDevelopment(process.env).apiTarget;
  if (p[0] === 'auth' && p[1] === 'login') {
    if (process.stdin.isTTY)
      throw new Error('Pipe a personal API token from Settings → API tokens into this command.');
    let token = '';
    for await (const chunk of process.stdin) {
      token += chunk;
      if (token.length > 4096) throw new Error('Token input is too long');
    }
    token = required(token.trim(), 'token');
    await new TicketsClient({ url, token }).request('/api/v1/me');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(configPath, JSON.stringify({ url, token }), { mode: 0o600 });
    await chmod(configPath, 0o600);
    console.log('Authenticated. Credential stored in local 0600 file.');
    return;
  }
  if (p[0] === 'auth' && p[1] === 'logout') {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(configPath, '{}', { mode: 0o600 });
    await chmod(configPath, 0o600);
    console.log('Local credential removed. Revoke the server token in Settings if needed.');
    return;
  }
  const token = required(process.env.TICKETS_TOKEN || config.token, 'TICKETS_TOKEN or auth login'),
    client = new TicketsClient({ url, token });
  let result, cached;
  const catalog = () => (cached ??= client.catalog());
  async function team(v) {
    required(v, '--team');
    return required(
      (await catalog()).teams.find((t) => t.id === v || t.key === v)?.id,
      'valid team',
    );
  }
  async function person(v) {
    if (v === 'none') return null;
    return required(
      (await catalog()).people.find((u) => u.id === v || u.email === v)?.id,
      'valid assignee',
    );
  }
  if (p[0] === 'catalog') result = await catalog();
  else if (p[0] === 'api')
    result = await client.request(required(p[2], 'path'), {
      method: required(p[1], 'method').toUpperCase(),
      body: o.data ? JSON.parse(o.data) : undefined,
    });
  else if (p[0] === 'issues') {
    const key = p[2];
    if (p[1] === 'list') {
      const f = {
        q: o.q,
        assignee_id: o.assignee,
        status_id: o.status,
        team_id: o.team ? await team(o.team) : undefined,
      };
      if (o.all) {
        result = [];
        for await (const i of client.issues(f)) result.push(i);
      } else result = await client.listIssues(f);
    } else if (p[1] === 'get') result = await client.issue(required(key, 'issue key'));
    else if (p[1] === 'create')
      result = await client.createIssue(
        {
          team_id: await team(o.team),
          title: required(o.title, '--title'),
          description: await body(o),
          ...(o.assignee ? { assignee_id: await person(o.assignee) } : {}),
          ...(o.status ? { status_id: o.status } : {}),
          ...(o.priority ? { priority: Number(o.priority) } : {}),
        },
        { idempotencyKey: o['idempotency-key'] },
      );
    else if (['update', 'archive', 'restore'].includes(p[1])) {
      const patch = { version: Number(required(o.version, '--version')) };
      if (p[1] === 'archive') patch.archived = true;
      else if (p[1] === 'restore') {
        patch.archived = false;
        patch.deleted = false;
      } else {
        if (o.title) patch.title = o.title;
        if (o.status) patch.status_id = o.status;
        if (o.priority !== undefined) patch.priority = Number(o.priority);
        if (o.due) patch.due_date = o.due === 'none' ? null : o.due;
        if (o.assignee) patch.assignee_id = await person(o.assignee);
        if (o.body !== undefined || o['body-file']) patch.description = await body(o);
      }
      result = await client.updateIssue(required(key, 'issue key'), patch);
    } else if (p[1] === 'comment')
      result = await client.comment(
        required(key, 'issue key'),
        required(await body(o), '--body or --body-file'),
      );
    else if (p[1] === 'link') {
      const target = await client.issue(required(o.target, '--target'));
      result = await client.request(
        `/api/v1/issues/${encodeURIComponent(required(key, 'issue key'))}/relations`,
        { method: 'POST', body: { target_id: target.id, type: required(o.type, '--type') } },
      );
    } else throw new Error('Unknown issues command');
  } else if (['projects', 'cycles'].includes(p[0])) {
    if (p[1] === 'list') result = await client.request('/api/v1/' + p[0]);
    else if (p[1] === 'create')
      result = await client.request('/api/v1/' + p[0], {
        method: 'POST',
        body:
          p[0] === 'projects'
            ? {
                name: required(o.name, '--name'),
                description: await body(o),
                team_ids: [await team(o.team)],
              }
            : {
                name: required(o.name, '--name'),
                team_id: await team(o.team),
                start_date: required(o.start, '--start'),
                end_date: required(o.end, '--end'),
              },
      });
    else throw new Error('Unknown command');
  } else throw new Error('Unknown command. Run tickets --help.');
  print(result, o.json || !process.stdout.isTTY);
}
main().catch((e) => {
  console.error(
    JSON.stringify({
      error: { code: e.code ?? 'CLI_ERROR', message: e.message, details: e.details },
    }),
  );
  process.exitCode =
    e.status === 409
      ? 4
      : [401, 403].includes(e.status)
        ? 3
        : [400, 422].includes(e.status)
          ? 2
          : 1;
});
