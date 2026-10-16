import { createHmac, timingSafeEqual } from 'node:crypto';
import { assert } from '../../core/errors.mjs';
import { canonical, uuid } from '../../../imports/linear-source.mjs';
import { parseMarkdown } from '../../../generated/server-markdown.mjs';

const PREFIX = '> **Managed in Tasks-app**';
const RECORD = 'tasks-linear-migration-v1.';
const KEY = /^[A-Z][A-Z0-9]{1,15}-[1-9][0-9]*$/;
const failure = (condition, message) =>
  assert(condition, 409, 'SYNC_MIGRATION_NOTICE_INVALID', message);
function context(value) {
  let origin;
  try {
    const url = new URL(value.appOrigin);
    failure(
      url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        url.pathname === '/' &&
        !url.search &&
        !url.hash,
      'Migration origin must be a canonical HTTPS origin',
    );
    origin = url.origin;
  } catch (error) {
    if (error.code) throw error;
    failure(false, 'Migration origin is unavailable');
  }
  failure(
    uuid(value.organizationId) &&
      uuid(value.sourceId) &&
      uuid(value.targetId) &&
      KEY.test(value.code ?? ''),
    'Migration identities or code are invalid',
  );
  failure(
    typeof value.secret === 'string' && value.secret.length >= 16,
    'Migration signing configuration is unavailable',
  );
  return { ...value, appOrigin: origin };
}
function signature(value) {
  return createHmac('sha256', value.secret)
    .update(
      canonical([
        'tasks-linear-migration',
        1,
        value.appOrigin,
        value.organizationId,
        value.sourceId,
        value.targetId,
        value.code,
      ]),
    )
    .digest('hex');
}
function header(value) {
  const url = value.appOrigin + '/tasks/' + value.code;
  const marker = [
    value.organizationId,
    value.sourceId,
    value.targetId,
    value.code,
    signature(value),
  ].join('.');
  return `${PREFIX} — [${value.code}](${url})\n>\n> Continue work in Tasks-app. [Migration record](${url}#${RECORD}${marker})`;
}
function semantic(value) {
  if (Array.isArray(value)) return value.map(semantic);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'position' && key !== 'spread')
        .map(([key, item]) => [key, semantic(item)]),
    );
  return value;
}
function links(node, result = []) {
  if (node.type === 'link') result.push(node);
  for (const child of node.children ?? []) links(child, result);
  return result;
}
export function createMigrationNotice(body, value) {
  assert(typeof body === 'string', 422, 'INVALID_DESCRIPTION', 'Description must be text');
  failure(
    !(body.startsWith(PREFIX) && body.slice(0, 8192).includes('#' + RECORD)),
    'A managed notice must be replaced rather than duplicated',
  );
  const checked = context(value);
  return header(checked) + '\n\n---\n\n' + body;
}
export function readMigrationNotice(body, expected = {}) {
  assert(typeof body === 'string', 422, 'INVALID_DESCRIPTION', 'Description must be text');
  // A user-authored Tasks link, quote or pasted example elsewhere is business content.
  const prefix = body.slice(0, 8192);
  if (!prefix.includes('#' + RECORD) || !body.startsWith('>')) return { body, notice: null };
  failure(body.startsWith(PREFIX), 'Managed notice heading was edited');
  const divider = /\r?\n[ \t]*(?:---|\*\*\*|___)[ \t]*\r?\n(?:\r?\n|$)/.exec(prefix);
  failure(divider, 'Managed notice has no bounded terminator');
  const rawHeader = body.slice(0, divider.index);
  const parsed = parseMarkdown(rawHeader),
    found = links(parsed);
  failure(
    found.length === 2 && parsed.children?.length === 1 && parsed.children[0].type === 'blockquote',
    'Managed notice shape was edited',
  );
  const fragment = found[1].url.split('#');
  failure(fragment.length === 2 && fragment[1].startsWith(RECORD), 'Migration record is malformed');
  const parts = fragment[1].slice(RECORD.length).split('.');
  failure(parts.length === 5, 'Migration record has unexpected fields');
  const [organizationId, sourceId, targetId, code, mac] = parts;
  const notice = context({ ...expected, organizationId, sourceId, targetId, code });
  for (const key of ['organizationId', 'sourceId', 'targetId'])
    if (expected[key] !== undefined)
      failure(
        expected[key] === notice[key],
        'Migration record belongs to a different task or workspace',
      );
  failure(/^[a-f0-9]{64}$/.test(mac), 'Migration record signature is malformed');
  failure(
    timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(signature(notice), 'hex')),
    'Migration record signature was not verified',
  );
  failure(
    canonical(semantic(parsed)) === canonical(semantic(parseMarkdown(header(notice)))),
    'Managed block contains unrecognized user changes',
  );
  const rest = body.slice(divider.index + divider[0].length);
  failure(
    !(rest.startsWith(PREFIX) && rest.slice(0, 8192).includes('#' + RECORD)),
    'Duplicate managed notices need reconciliation',
  );
  // Never return the signing secret or include it in audit records or source payloads.
  return {
    body: rest,
    notice: { appOrigin: notice.appOrigin, organizationId, sourceId, targetId, code },
  };
}
export function retainMigrationNotice(body, previous, expected) {
  const parsed = readMigrationNotice(previous, expected);
  return parsed.notice ? createMigrationNotice(body, { ...parsed.notice, ...expected }) : body;
}

// GraphQL response normalization is deliberately restricted to issue records. Other descriptions
// (projects, comments, documents) and user-authored links are never treated as migration blocks.
export async function normalizeMigrationNotices(data, env, verifyIdentities) {
  const marked = [];
  const inspect = (record) => {
    if (!record || typeof record.description !== 'string') return record;
    const parsed = readMigrationNotice(record.description, {
      appOrigin: env.APP_URL,
      secret: env.LINEAR_WEBHOOK_SECRET,
      sourceId: record.id,
    });
    if (parsed.notice) marked.push({ record, notice: parsed.notice, body: parsed.body });
    return record;
  };
  if (data.issue) inspect(data.issue);
  for (const record of data.issues?.nodes ?? []) inspect(record);
  for (const action of ['issueCreate', 'issueUpdate'])
    if (data[action]?.issue) inspect(data[action].issue);
  if (!marked.length) return data;
  failure(
    typeof verifyIdentities === 'function',
    'Mapped migration identity verification is required',
  );
  // Do not expose a stripped description until every signed identity has also
  // been checked against this workspace's actual current source mappings.
  await verifyIdentities(marked.map(({ record, notice }) => ({ record, notice })));
  const replacements = new Map(
    marked.map(({ record, notice, body }) => [
      record,
      {
        ...record,
        description: body,
        _migrationNotice: notice,
      },
    ]),
  );
  const output = { ...data };
  if (output.issue) output.issue = replacements.get(output.issue) ?? output.issue;
  if (Array.isArray(output.issues?.nodes))
    output.issues = {
      ...output.issues,
      nodes: output.issues.nodes.map((record) => replacements.get(record) ?? record),
    };
  for (const action of ['issueCreate', 'issueUpdate'])
    if (output[action]?.issue) {
      output[action] = {
        ...output[action],
        issue: replacements.get(output[action].issue) ?? output[action].issue,
      };
    }
  return output;
}

export function mappedNoticeVerifier(
  db,
  config,
  { allowStaleCode = false, allowSourceTeamMove = false } = {},
) {
  return async (entries) => {
    failure(entries.length <= 250, 'Too many migration records in one response');
    const ids = [...new Set(entries.map(({ record }) => record.id))];
    const { rows, teams } = await db.transaction(
      async (tx) => {
        const rows = await tx.all(
          "SELECT m.source_id,m.target_id,i.key,i.team_id FROM linear_source_map m JOIN issues i ON i.workspace_id=m.workspace_id AND i.id=m.target_id WHERE m.workspace_id=? AND m.source_workspace_id=? AND m.collection='issues' AND m.source_id IN (" +
            ids.map(() => '?').join(',') +
            ')',
          [config.workspaceId, config.organizationId, ...ids],
        );
        const mapped = new Map(rows.map((row) => [row.source_id, row]));
        const movedTeams = allowSourceTeamMove
          ? [
              ...new Set(
                entries
                  .filter(({ record }) => record.identifier !== mapped.get(record.id)?.key)
                  .map(({ record }) => record.team?.id)
                  .filter(uuid),
              ),
            ]
          : [];
        const teams = movedTeams.length
          ? await tx.all(
              "SELECT m.source_id,t.id,t.key FROM linear_source_map m JOIN teams t ON t.workspace_id=m.workspace_id AND t.id=m.target_id WHERE m.workspace_id=? AND m.source_workspace_id=? AND m.collection='teams' AND m.source_id IN (" +
                movedTeams.map(() => '?').join(',') +
                ')',
              [config.workspaceId, config.organizationId, ...movedTeams],
            )
          : [];
        return { rows, teams };
      },
      { readOnly: true },
    );
    const bySource = new Map(rows.map((row) => [row.source_id, row]));
    for (const { record, notice } of entries) {
      const mapping = bySource.get(record.id);
      failure(
        notice.organizationId === config.organizationId &&
          notice.sourceId === record.id &&
          mapping?.target_id === notice.targetId,
        'Migration notice does not match the active task mapping',
      );
      // Only authoritative inbound reads may reconcile a mutable code. Native export and
      // notice writes retain code equality so stale native work cannot undo a source move.
      // A signed old code is not an immutable identity: two source moves can precede
      // notice refresh. The authenticated source/target/organization mapping above,
      // and mapped destination/canonical number below, remain the authority.
      if (allowSourceTeamMove && record.identifier !== mapping.key) {
        const team = teams.find((row) => row.source_id === record.team?.id);
        failure(
          team &&
            config.teamIds.includes(record.team?.id) &&
            Number.isInteger(record.number) &&
            record.number > 0 &&
            record.number < 2147483647 &&
            record.identifier === team.key + '-' + record.number &&
            team.id !== mapping.team_id,
          'Source move requires a configured mapped team and canonical source code',
        );
        continue;
      }
      failure(record.identifier === mapping.key, 'Source and native task codes differ');
      failure(
        allowStaleCode || notice.code === record.identifier,
        'Migration notice code is stale',
      );
    }
  };
}
