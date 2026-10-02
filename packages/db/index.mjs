import { mkdir, readFile } from 'node:fs/promises';
import { DEFAULT_SQLITE_PATH } from '../config/development.mjs';
import { dirname } from 'node:path';

// Values always remain bound parameters. This scanner skips quoted SQL literals.
export function postgresParameters(sql) {
  let n = 0,
    quoted = false,
    output = '';
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") {
      if (quoted && sql[i + 1] === "'") {
        output += "''";
        i++;
        continue;
      }
      quoted = !quoted;
    }
    output += c === '?' && !quoted ? `$${++n}` : c;
  }
  return output;
}

// Leave half of the 60-second serverless budget for useful database work.
export const POSTGRES_POOL_OPTIONS = Object.freeze({
  max: 4,
  idleTimeoutMillis: 5000,
  connectionTimeoutMillis: 30000,
});

export async function createDatabase({
  url,
  sqlitePath = DEFAULT_SQLITE_PATH,
  production = false,
} = {}) {
  if (url) {
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: url,
      ...POSTGRES_POOL_OPTIONS,
    });
    if (process.env.VERCEL) {
      const { attachDatabasePool } = await import('@vercel/functions');
      attachDatabasePool(pool);
    }
    return {
      dialect: 'postgres',
      async transaction(fn, { readOnly = false } = {}) {
        const connection = await pool.connect();
        try {
          await connection.query(
            readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN',
          );
          const tx = {
            dialect: 'postgres',
            all: async (sql, args = []) =>
              (await connection.query(postgresParameters(sql), args)).rows,
            one: async (sql, args = []) =>
              (await connection.query(postgresParameters(sql), args)).rows[0] ?? null,
            exec: async (sql, args = []) => ({
              changes: (await connection.query(postgresParameters(sql), args)).rowCount,
            }),
            script: async (sql) => {
              await connection.query(sql);
            },
            lock: async (workspace) => {
              await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))', [workspace]);
            },
          };
          const result = await fn(tx);
          await connection.query('COMMIT');
          return result;
        } catch (error) {
          await connection.query('ROLLBACK').catch(() => {});
          throw error;
        } finally {
          connection.release();
        }
      },
      close: () => pool.end(),
    };
  }
  if (production)
    throw new Error('DATABASE_URL is required in production. SQLite fallback is disabled.');
  if (sqlitePath !== ':memory:') await mkdir(dirname(sqlitePath), { recursive: true });
  const { Database: DatabaseSync } = await import('bun:sqlite');
  const connection = new DatabaseSync(sqlitePath);
  connection.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  let queue = Promise.resolve();
  return {
    dialect: 'sqlite',
    transaction(fn) {
      // Reads use the same mutex: no read can observe a partially committed mutation.
      const result = queue.then(async () => {
        connection.exec('BEGIN IMMEDIATE');
        const tx = {
          dialect: 'sqlite',
          all: async (sql, args = []) => connection.prepare(sql).all(...args),
          one: async (sql, args = []) => connection.prepare(sql).get(...args) ?? null,
          exec: async (sql, args = []) => connection.prepare(sql).run(...args),
          script: async (sql) => connection.exec(sql),
          lock: async () => {},
        };
        try {
          const value = await fn(tx);
          connection.exec('COMMIT');
          return value;
        } catch (error) {
          connection.exec('ROLLBACK');
          throw error;
        }
      });
      queue = result.then(
        () => {},
        () => {},
      );
      return result;
    },
    async close() {
      await queue;
      connection.close();
    },
  };
}
const migrations = [
  { version: 1, path: './migrations/0001.sql' },
  { version: 2, path: './migrations/0002_avatar.sql' },
  { version: 3, path: './migrations/0003_workspace_policy.sql' },
  { version: 4, path: './migrations/0004_account_email.sql' },
  { version: 5, path: './migrations/0005_linear_import.sql' },
  { version: 6, path: './migrations/0006_source_people_query.sql' },
  { version: 7, path: './migrations/0007_imported_files.sql' },
];
export const CURRENT_SCHEMA_VERSION = migrations.at(-1).version;
export async function migrate(db) {
  const sources = await Promise.all(
    migrations.map(async (m) => ({
      ...m,
      sql: await readFile(new URL(m.path, import.meta.url), 'utf8'),
    })),
  );
  return db.transaction(async (tx) => {
    await tx.lock('tickets-app:migrations');
    await tx.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
    );
    const applied = await tx.all('SELECT version FROM schema_migrations ORDER BY version');
    if (applied.some((row) => !migrations.some((m) => m.version === row.version)))
      throw new Error(
        'Database schema is newer than this application. Refusing to migrate an unknown version.',
      );
    let changed = false;
    for (const migration of sources) {
      if (applied.some((row) => row.version === migration.version)) continue;
      await tx.script(migration.sql);
      await tx.exec('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)', [
        migration.version,
        new Date().toISOString(),
      ]);
      changed = true;
    }
    return { applied: changed, version: migrations.at(-1).version };
  });
}
