import { assert } from '../../core/errors.mjs';
const TABLES = new Set([
  'issues',
  'comments',
  'activity',
  'external_links',
  'linear_import_records',
  'linear_source_map',
  'issue_labels',
]);
// Bound both parameter count and payload bytes; one large source record is never multiplied by a 100-row batch.
export async function insertSourceRows(tx, table, rows) {
  assert(TABLES.has(table), 500, 'INVALID_TABLE', 'Unexpected source table');
  let offset = 0;
  while (offset < rows.length) {
    const keys = Object.keys(rows[offset]),
      batch = [];
    let bytes = 0;
    while (offset < rows.length && batch.length < 100) {
      const row = rows[offset],
        size = Buffer.byteLength(JSON.stringify(row));
      if (batch.length && bytes + size > 1000000) break;
      assert(
        keys.every((k) => /^[a-z_]+$/.test(k)) && Object.keys(row).join(',') === keys.join(','),
        500,
        'INVALID_COLUMNS',
        'Unexpected source row shape',
      );
      batch.push(row);
      bytes += size;
      offset++;
    }
    await tx.exec(
      `INSERT INTO ${table}(${keys.join(',')}) VALUES ${batch.map(() => `(${keys.map(() => '?').join(',')})`).join(',')}`,
      batch.flatMap((row) => keys.map((key) => row[key])),
    );
  }
}
