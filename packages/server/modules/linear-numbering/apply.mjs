import { assert } from '../../core/errors.mjs';
const TEXT_FIELDS = Object.freeze({
  issues: new Set(['title', 'description']),
  comments: new Set(['body']),
  projects: new Set(['name', 'description']),
  documents: new Set(['title', 'body']),
  initiatives: new Set(['name', 'description']),
});
export async function applyReferenceEdits(tx, workspace, edits, renumberedIssues, stamp) {
  const groups = new Map();
  for (const edit of edits) {
    assert(
      TEXT_FIELDS[edit.table]?.has(edit.field),
      500,
      'INVALID_REFERENCE_LOCATION',
      'Unexpected reference rewrite target',
    );
    const key = edit.table + ':' + edit.id;
    if (!groups.has(key))
      groups.set(key, { table: edit.table, id: edit.id, version: edit.version, edits: [] });
    const group = groups.get(key);
    assert(
      group.version === edit.version && !group.edits.some((e) => e.field === edit.field),
      409,
      'REFERENCE_PLAN_INVALID',
      'Duplicate or mixed-version reference update',
    );
    group.edits.push(edit);
  }
  for (const group of groups.values()) {
    const expected =
      group.version + (group.table === 'issues' && renumberedIssues.has(group.id) ? 1 : 0);
    assert(
      Number.isInteger(expected),
      409,
      'REFERENCE_VERSION_REQUIRED',
      'A mutable reference requires its source version',
    );
    const changed = await tx.exec(
      `UPDATE ${group.table} SET ${group.edits.map((e) => e.field + '=?').join(',')},version=version+1,updated_at=? WHERE workspace_id=? AND id=? AND version=? AND ${group.edits.map((e) => e.field + '=?').join(' AND ')}`,
      [
        ...group.edits.map((e) => e.after),
        stamp,
        workspace,
        group.id,
        expected,
        ...group.edits.map((e) => e.before),
      ],
    );
    assert(
      Number(changed.changes) === 1,
      409,
      'REFERENCE_VERSION_CONFLICT',
      'A document changed after its reference plan was prepared',
      { table: group.table, id: group.id },
    );
  }
}
export async function applyCodeChanges(tx, workspace, changes, allIssues, receipt, stamp) {
  const occupied = new Set(allIssues.map((r) => r.team_id + ':' + r.number)),
    keys = new Set(allIssues.map((r) => r.key));
  let temporary = -2147483647;
  const planned = changes.map((change, index) => {
    while (occupied.has(change.teamId + ':' + temporary)) temporary++;
    assert(
      temporary < 0,
      409,
      'TEMPORARY_NUMBER_SPACE_EXHAUSTED',
      'No safe temporary numbering space',
    );
    const key = '~renumber:' + receipt + ':' + index;
    assert(
      !keys.has(key),
      409,
      'TEMPORARY_KEY_OCCUPIED',
      'Temporary numbering key is already occupied',
    );
    const item = { ...change, temporaryNumber: temporary++, temporaryKey: key };
    occupied.add(change.teamId + ':' + item.temporaryNumber);
    return item;
  });
  for (const temporaryPass of [true, false])
    for (let offset = 0; offset < planned.length; offset += 100) {
      const batch = planned.slice(offset, offset + 100);
      const keyParams = batch.flatMap((r) => [r.id, temporaryPass ? r.temporaryKey : r.newCode]);
      const numberParams = batch.flatMap((r) => [
        r.id,
        temporaryPass ? r.temporaryNumber : r.newNumber,
      ]);
      const changed = await tx.exec(
        `UPDATE issues SET key=CASE id ${batch.map(() => 'WHEN ? THEN ?').join(' ')} END,number=CAST(CASE id ${batch.map(() => 'WHEN ? THEN ?').join(' ')} END AS INTEGER)${temporaryPass ? '' : ',version=version+1,updated_at=?'} WHERE workspace_id=? AND (${batch.map(() => '(id=? AND version=?)').join(' OR ')})`,
        [
          ...keyParams,
          ...numberParams,
          ...(temporaryPass ? [] : [stamp]),
          workspace,
          ...batch.flatMap((r) => [r.id, r.version]),
        ],
      );
      assert(
        Number(changed.changes) === batch.length,
        409,
        'NUMBERING_VERSION_CONFLICT',
        'A task changed after the canonical numbering plan',
      );
    }
}
