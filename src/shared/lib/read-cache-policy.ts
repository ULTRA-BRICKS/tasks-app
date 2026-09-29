/**
 * What the persistent read cache may keep on this device, and for how long.
 * Contract and rationale: docs/PERSISTENT-READ-CACHE.md.
 */
/** Record-format version; any other value on disk is discarded, never migrated. */
export const READ_CACHE_SCHEMA = 1;
/**
 * 24 hours since the entry was last confirmed by the server (UB-39 quorum majority). A longer
 * retention, e.g. the 7-day session lifetime, is a product-owner decision.
 */
export const READ_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export interface ReadCacheLimits {
  /** Saved read models per account and workspace, including the account itself. */
  entries: number;
  /** First pages kept per task list; Load more continues from the last kept cursor. */
  pages: number;
  /** Largest serialized entry; bigger replies stay in memory only. */
  entryChars: number;
}
export const READ_CACHE_LIMITS: ReadCacheLimits = { entries: 80, pages: 5, entryChars: 1_500_000 };
/** Query roots allowed on disk. Auth, tokens, invitations, integrations and policy never are. */
const PERSISTED_ROOTS: Record<string, true> = {
  me: true,
  catalog: true,
  issues: true,
  issue: true,
  projects: true,
  cycles: true,
  milestones: true,
  views: true,
};
export function isPersistedQueryKey(key: readonly unknown[]): boolean {
  return typeof key[0] === 'string' && Object.hasOwn(PERSISTED_ROOTS, key[0]);
}
/**
 * Field names dropped at any depth: credentials (defense in depth) and, per the UB-39 quorum (B2),
 * every email address. Tested on the snake_case form, so `passwordHash` counts as `password_hash`.
 * A stale frame may show split people until the live catalog regroups them.
 */
const PRIVATE_FIELD =
  /(?:^|_)(?:token|secret|password|passwd|credential|cookie|hash|oauth|signature|api_?key|private_?key|e?mail)s?(?:$|_)|^(?:invite|invitation|reset)/i;
const MAX_DEPTH = 24;
function scrub(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return null;
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const clean: Record<string, unknown> = {};
  for (const [field, item] of Object.entries(value))
    if (!PRIVATE_FIELD.test(field.replace(/([a-z\d])([A-Z])/g, '$1_$2')))
      clean[field] = scrub(item, depth + 1);
  return clean;
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
const ACCOUNT_FIELDS = ['id', 'name', 'role', 'workspace_id', 'avatar_url', 'scopes'];
/**
 * Returns the device-safe copy of a confirmed server reply, or undefined when it must stay in memory.
 * Infinite task lists keep their first `limits.pages` pages together with their cursors.
 */
export function sanitizeReadModel(
  key: readonly unknown[],
  data: unknown,
  limits: ReadCacheLimits = READ_CACHE_LIMITS,
): unknown {
  if (!isPersistedQueryKey(key)) return undefined;
  const value = record(data);
  switch (key[0]) {
    case 'me': {
      // Only an interactive browser session is ever cached; API-token actors are not.
      if (!value || value.auth_type !== 'session') return undefined;
      const account: Record<string, unknown> = { auth_type: 'session' };
      for (const field of ACCOUNT_FIELDS) if (field in value) account[field] = value[field];
      return scrub(account, 0);
    }
    case 'catalog': {
      if (!value) return undefined;
      const modules = Array.isArray(value.modules) ? value.modules : [];
      return scrub(
        {
          ...value,
          // Integration configuration (mappings, organization IDs) is settings data, not a read model.
          modules: modules.map((module) => ({ ...record(module), config: {} })),
          // Imported file source URLs can be pre-signed; they are refetched once online.
          imported_files: [],
        },
        0,
      );
    }
    case 'issues': {
      if (!value || !Array.isArray(value.pages) || !Array.isArray(value.pageParams))
        return undefined;
      return scrub(
        {
          pages: value.pages.slice(0, limits.pages),
          pageParams: value.pageParams.slice(0, limits.pages),
        },
        0,
      );
    }
    default:
      return data === undefined ? undefined : scrub(data, 0);
  }
}
