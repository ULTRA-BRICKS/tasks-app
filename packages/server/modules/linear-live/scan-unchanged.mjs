import { AppError } from '../../core/errors.mjs';
import { contextFor, normalizedNative, sourceMapping } from './context.mjs';
import { readEntityState } from './store.mjs';
// A skip is read-only: never advance a baseline, acknowledge a change, or infer deletion here.
export async function scanRecordIsUnchanged(tx, config, collection, record, sourceId, side) {
  const mapping = await sourceMapping(tx, config, collection, sourceId);
  if (!mapping) return false;
  const state = await readEntityState(tx, config.workspaceId, collection, sourceId);
  if (state?.intent || state?.removedAt || Object.keys(state?.conflicts ?? {}).length) return false;
  try {
    const original = JSON.parse(mapping.original);
    if (!original || typeof original !== 'object' || original.id !== sourceId) return false;
    if (side === 'source') {
      const observed = Date.parse(record.updatedAt),
        known = Date.parse(state?.sourceUpdatedAt ?? original.updatedAt);
      if (
        record.id !== sourceId ||
        !Number.isFinite(observed) ||
        !Number.isFinite(known) ||
        observed !== known
      )
        return false;
    }
    const context = await contextFor(tx, config, collection, original);
    if (!context.native || context.native.deleted_at) return false;
    if (
      collection === 'issues' &&
      context.native.key !== (state?.sourceCode ?? original.identifier)
    )
      return false;
    if (side === 'source') {
      // Linear archive operations may not advance updatedAt. Never rely on that timestamp alone.
      if (
        !Object.hasOwn(record, 'archivedAt') ||
        (record.archivedAt !== null && !Number.isFinite(Date.parse(record.archivedAt)))
      )
        return false;
      const knownArchive = state?.baseSource?.archived ?? Boolean(original.archivedAt);
      if (Boolean(record.archivedAt) !== knownArchive) return false;
      if (
        collection === 'issues' &&
        record.identifier !== (state?.sourceCode ?? original.identifier)
      )
        return false;
    }
    const baseline = state?.baseNative ?? context.source,
      fields = Object.keys(context.source);
    if (!fields.length || fields.some((field) => !Object.hasOwn(baseline, field))) return false;
    const native = normalizedNative(collection, context.native, fields);
    return fields.every((field) =>
      context.resolver.sameField(field, native[field], baseline[field]),
    );
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof AppError && [404, 409, 422].includes(error.status))
    )
      return false;
    throw error;
  }
}
