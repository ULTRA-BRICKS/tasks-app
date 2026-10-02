import { CURRENT_SCHEMA_VERSION } from '../db/index.mjs';
// Public readiness reveals no SQL, counts, identifiers or credentials. No writes.
export async function inspectReadiness(db) {
  try {
    return await db.transaction(
      async (tx) => {
        const rows = await tx.all('SELECT version FROM schema_migrations ORDER BY version');
        if (
          rows.length !== CURRENT_SCHEMA_VERSION ||
          rows.some((r, i) => Number(r.version) !== i + 1)
        )
          return { status: 'not_ready', code: 'MIGRATION_REQUIRED' };
        const owner = await tx.one("SELECT user_id FROM memberships WHERE role='owner' LIMIT 1");
        return owner ? { status: 'ready' } : { status: 'not_ready', code: 'OWNER_SETUP_REQUIRED' };
      },
      { readOnly: true },
    );
  } catch {
    return { status: 'not_ready', code: 'DATABASE_SETUP_REQUIRED' };
  }
}
