import { assert, requirePermission } from '../../core/errors.mjs';
import { uuid } from '../../../imports/linear-source.mjs';
const SECTIONS = Object.freeze({
  issues: 'issues',
  comments: 'comments',
  projects: 'projects',
  documents: 'documents',
  initiatives: 'initiatives',
  milestones: 'milestones',
  cycles: 'cycles',
  teams: 'teams',
  statuses: 'statuses',
  labels: 'labels',
  relations: 'relations',
  links: 'external_links',
  views: 'saved_views',
  mappings: 'linear_source_map',
  imports: 'linear_imports',
});
function decodeCursor(value, section) {
  if (!value) return null;
  assert(
    typeof value === 'string' && value.length <= 512,
    422,
    'INVALID_GRAPH_CURSOR',
    'Invalid graph cursor',
  );
  let cursor;
  try {
    cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    assert(false, 422, 'INVALID_GRAPH_CURSOR', 'Invalid graph cursor');
  }
  assert(
    cursor?.section === section && Array.isArray(cursor.key),
    422,
    'INVALID_GRAPH_CURSOR',
    'Cursor belongs to another graph section',
  );
  if (section === 'mappings')
    assert(
      cursor.key.length === 3 &&
        uuid(cursor.key[0]) &&
        /^[A-Za-z]{1,50}$/.test(cursor.key[1]) &&
        uuid(cursor.key[2]),
      422,
      'INVALID_GRAPH_CURSOR',
      'Invalid mapping cursor',
    );
  else
    assert(
      cursor.key.length === 1 && uuid(cursor.key[0]),
      422,
      'INVALID_GRAPH_CURSOR',
      'Invalid row cursor',
    );
  return cursor.key;
}
export async function numberingGraphPage(tx, actor, { section, limit = 100, cursor } = {}) {
  requirePermission(actor, 'admin');
  if (!section)
    return {
      scope:
        'current authenticated workspace; external repositories and conversations require separate coverage',
      sections: Object.keys(SECTIONS),
      max_page_records: 100,
      max_page_bytes: 1000000,
    };
  assert(
    Object.hasOwn(SECTIONS, section) && Number.isInteger(limit) && limit > 0 && limit <= 100,
    422,
    'INVALID_GRAPH_SECTION',
    'Invalid graph section or page size',
  );
  const key = decodeCursor(cursor, section),
    table = SECTIONS[section];
  const order = section === 'mappings' ? 'source_workspace_id,collection,source_id' : 'id';
  const columns =
    section === 'imports'
      ? 'id,source_workspace_id,status,manifest,created_by,created_at,completed_at'
      : '*';
  const rows = await tx.all(
    `SELECT ${columns} FROM ${table} WHERE workspace_id=? ${key ? 'AND (' + order + ')>(' + key.map(() => '?').join(',') + ')' : ''} ORDER BY ${order} LIMIT ?`,
    [actor.workspace_id, ...(key ?? []), limit],
  );
  const records = [];
  let bytes = 0;
  for (const row of rows) {
    const size = Buffer.byteLength(JSON.stringify(row));
    assert(
      size <= 900000,
      413,
      'GRAPH_ROW_TOO_LARGE',
      'Read the oversized source resource through its dedicated endpoint',
    );
    if (records.length && bytes + size > 900000) break;
    records.push(row);
    bytes += size;
  }
  const last = records.at(-1),
    more = records.length < rows.length || rows.length === limit;
  const next =
    last && more
      ? Buffer.from(
          JSON.stringify({
            section,
            key:
              section === 'mappings'
                ? [last.source_workspace_id, last.collection, last.source_id]
                : [last.id],
          }),
        ).toString('base64url')
      : null;
  return { section, records, next_cursor: next, bytes, scope: 'workspace:' + actor.workspace_id };
}
