import { createDatabase, migrate } from '../packages/db/index.mjs';
import { bootstrap } from '../packages/server/modules/identity/service.mjs';
import { seedDemo } from '../packages/server/demo.mjs';
const command = process.argv[2];
const isDemo = command === 'demo';
if (isDemo && (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL))
  throw new Error('Demo seed is local-only. Production is never seeded with demo accounts.');
const db = await createDatabase({
  url:
    command === 'migrate'
      ? process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
      : process.env.DATABASE_URL,
  sqlitePath: process.env.SQLITE_PATH,
  production: process.env.NODE_ENV === 'production',
});
try {
  if (command === 'migrate') console.log(await migrate(db));
  else if (command === 'bootstrap')
    console.log(
      await bootstrap(db, {
        email: process.env.BOOTSTRAP_EMAIL,
        name: process.env.BOOTSTRAP_NAME,
        password: process.env.BOOTSTRAP_PASSWORD,
        workspaceName: process.env.WORKSPACE_NAME,
        slug: process.env.WORKSPACE_SLUG,
      }),
    );
  else if (isDemo) {
    await migrate(db);
    console.log(await seedDemo(db));
  } else throw new Error('Usage: bun scripts/db.mjs migrate|bootstrap|demo');
} finally {
  await db.close();
}
