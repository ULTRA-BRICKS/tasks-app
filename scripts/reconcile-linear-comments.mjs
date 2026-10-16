/** Operator repair entrypoint: explicit database selection, read-only preview, hash-bound apply.
 * SQLite never creates files; PostgreSQL uses the shared transaction API and never migrates.
 */
import { Database } from 'bun:sqlite';
import { isAbsolute } from 'node:path';
import { createDatabase } from '../packages/db/index.mjs';
import { AppError } from '../packages/server/core/errors.mjs';
import { reconcileLinearComments } from '../packages/server/modules/linear-import/reconcile-comments.mjs';

export async function runLocalCommentReconciliation(
  args,
  { env = process.env, openDatabase = createDatabase } = {},
) {
  const values = new Map(),
    comments = [];
  const allowed = new Set([
    '--sqlite',
    '--postgres-env',
    '--workspace',
    '--actor',
    '--source',
    '--comment',
    '--apply-plan',
  ]);
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i],
      value = args[i + 1];
    if (
      !allowed.has(flag) ||
      !value ||
      value.startsWith('--') ||
      (flag !== '--comment' && values.has(flag))
    )
      throw Error('Provide distinct named arguments; repeat --comment for each source UUID');
    if (flag === '--comment') comments.push(value);
    else values.set(flag, value);
  }
  const path = values.get('--sqlite');
  const variable = values.get('--postgres-env');
  if (
    Boolean(path) === Boolean(variable) ||
    (path && !isAbsolute(path)) ||
    !values.get('--workspace') ||
    !values.get('--actor') ||
    !values.get('--source')
  )
    throw Error(
      'Usage: bun scripts/reconcile-linear-comments.mjs (--sqlite /absolute/local.sqlite | --postgres-env VARIABLE_NAME) --workspace UUID --actor UUID --source UUID --comment UUID [--comment UUID] [--apply-plan HASH]',
    );
  const plan = values.get('--apply-plan');
  if (plan && !/^[a-f0-9]{64}$/.test(plan)) throw Error('Provide a preview plan hash');
  const reconcile = async (tx) => {
    const membership = await tx.one(
      'SELECT role FROM memberships WHERE workspace_id=? AND user_id=?',
      [values.get('--workspace'), values.get('--actor')],
    );
    if (!membership)
      throw new AppError(403, 'FORBIDDEN', 'Actor has no membership in this workspace');
    return reconcileLinearComments(
      tx,
      {
        id: values.get('--actor'),
        workspace_id: values.get('--workspace'),
        role: membership.role,
        scopes: ['admin'],
      },
      {
        source_workspace_id: values.get('--source'),
        source_ids: comments,
        ...(plan ? { plan_hash: plan } : {}),
      },
    );
  };
  if (variable) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable))
      throw Error('Provide an environment variable name');
    const url = env[variable];
    if (!url) throw Error('Named PostgreSQL URL environment variable is unset or empty');
    try {
      if (!['postgres:', 'postgresql:'].includes(new URL(url).protocol)) throw Error();
    } catch {
      throw Error('Named environment variable must contain a PostgreSQL URL');
    }
    try {
      const db = await openDatabase({ url, production: true });
      try {
        return await db.transaction(
          async (tx) => {
            if (plan) {
              await tx.exec('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
              await tx.lock(values.get('--workspace'));
            }
            return reconcile(tx);
          },
          { readOnly: !plan },
        );
      } finally {
        await db.close();
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      // Driver errors can contain connection credentials or private query values.
      throw Error(
        'PostgreSQL reconciliation failed; no result confirmed. Check service access/schema and preview again before retrying.',
      );
    }
  }
  if (env.NODE_ENV === 'production' || env.VERCEL)
    throw Error('SQLite repair is local only; select PostgreSQL explicitly with --postgres-env');
  const db = new Database(
    path,
    plan ? { readwrite: true, create: false } : { readonly: true, create: false },
  );
  try {
    db.exec('PRAGMA foreign_keys=ON');
    db.exec(plan ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try {
      const tx = {
        dialect: 'sqlite',
        all: async (sql, params = []) => db.prepare(sql).all(...params),
        one: async (sql, params = []) => db.prepare(sql).get(...params) ?? null,
        exec: async (sql, params = []) => {
          if (!plan) throw Error('Read-only preview cannot mutate data');
          return db.prepare(sql).run(...params);
        },
        lock: async () => {},
      };
      const result = await reconcile(tx);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  try {
    console.log(
      JSON.stringify(await runLocalCommentReconciliation(process.argv.slice(2)), null, 2),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Comment reconciliation failed');
    process.exitCode = 1;
  }
}
