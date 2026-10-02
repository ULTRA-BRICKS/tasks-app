// Generic per-field 3-way compare. `baseline` should essentially never be null for an
// entity that went through the import (bootstrap it from the frozen linear_import_records
// payload via map.mjs before calling this). `baseline === null` legitimately means "brand
// new entity, no local row yet" — a plain create, never routed through this function.
function same(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

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
    if (same(localValue, remoteValue)) {
      result[field] = localValue;
      continue;
    }
    if (same(baselineValue, localValue)) {
      // Local never touched this field: remote wins.
      result[field] = remoteValue;
      continue;
    }
    if (same(baselineValue, remoteValue)) {
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
