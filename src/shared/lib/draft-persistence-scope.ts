/**
 * state-lib owner of a recovery-draft store: the revision cell is a scope value and the
 * store itself is a scope resource, so scope disposal releases the cross-tab subscription,
 * indexes and caches and makes any late acknowledgement a no-op. Framework-agnostic; the
 * React Provider lives in ./draft-persistence-context.
 */
import {
  createDraftPersistence,
  type DraftPersistence,
  type DraftPersistenceOptions,
  type DraftPorts,
} from './draft-persistence';
import type { Scope } from './state/scope';

export function createScopedDraftPersistence(
  scope: Scope,
  ports: DraftPorts & Pick<DraftPersistenceOptions, 'writerId'>,
): DraftPersistence {
  const revision = scope.value(0);
  const store = createDraftPersistence({
    ...ports,
    revision: { read: revision.getSnapshot, publish: (next) => revision.set(next) },
  });
  scope.resource(store, (owned) => owned.dispose());
  return store;
}
