import { migrate } from '../packages/db/index.mjs';
import { seedDemo } from '../packages/server/demo.mjs';

export async function initializeLocalDemo(db) {
  if (db.dialect !== 'sqlite') throw new Error('Demo setup is SQLite-only');
  await migrate(db);
  const existing = await db.transaction((tx) => tx.one('SELECT id FROM users LIMIT 1'));
  if (existing) return { status: 'existing' };
  try {
    await seedDemo(db);
    return { status: 'created' };
  } catch (error) {
    // A concurrent setup may have won the empty-database bootstrap lock.
    if (error.code === 'ALREADY_INITIALIZED') return { status: 'existing' };
    throw error;
  }
}
