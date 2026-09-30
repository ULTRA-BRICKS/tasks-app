import { canonical } from '../../../imports/linear-source.mjs';
import { markdownEquivalent } from '../linear-import/source-contract.mjs';
// Fields holding Markdown, which Linear rewrites when it stores it; compared semantically.
export const MARKDOWN_FIELDS = Object.freeze(['description', 'body']);
// Titles keep their words but not necessarily their whitespace: native trims them on every
// write, and a stored title may come back with collapsed line breaks or spaces. Comparing
// them raw would turn that into a rename nobody made, re-applied on every reconcile.
const titleText = (value) => value.trim().replace(/\s+/g, ' ');
// Generic per-field 3-way compare. `baseline` should essentially never be null for an
// entity that went through the import (bootstrap it from the frozen linear_import_records
// payload via map.mjs before calling this). `baseline === null` legitimately means "brand
// new entity, no local row yet" — a plain create, never routed through this function.
export const sameField = (field, a, b) => {
  if (a === b) return true;
  if (typeof a === 'string' && typeof b === 'string') {
    if (MARKDOWN_FIELDS.includes(field)) return markdownEquivalent(a, b);
    if (field === 'title') return titleText(a) === titleText(b);
  }
  return canonical(a ?? null) === canonical(b ?? null);
};

/**
 * @returns {{result: object, conflicts: Array<{field,baseline_value,local_value,remote_value}>}}
 */
export function mergeFields(baseline, local, remote, fields) {
  const result = {};
  const conflicts = [];
  for (const field of fields) {
    const localValue = local?.[field] ?? null;
    const remoteValue = remote?.[field] ?? null;
    const baselineValue = baseline?.[field] ?? null;
    if (sameField(field, localValue, remoteValue)) {
      result[field] = localValue;
      continue;
    }
    if (sameField(field, baselineValue, localValue)) {
      // Local never touched this field: remote wins.
      result[field] = remoteValue;
      continue;
    }
    if (sameField(field, baselineValue, remoteValue)) {
      // Remote never changed this field: keep the local edit.
      result[field] = localValue;
      continue;
    }
    // Both sides changed the field to different values: local wins, conflict recorded.
    result[field] = localValue;
    conflicts.push({
      field,
      baseline_value: baselineValue,
      local_value: localValue,
      remote_value: remoteValue,
    });
  }
  return { result, conflicts };
}
