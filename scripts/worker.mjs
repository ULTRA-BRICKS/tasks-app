import { deliverAccountEmails } from '../packages/server/modules/email/service.mjs';
import { createDatabase } from '../packages/db/index.mjs';
import { runWorker } from '../packages/server/modules/integrations/service.mjs';
const db = await createDatabase({
  url: process.env.DATABASE_URL,
  sqlitePath: process.env.SQLITE_PATH,
  production: process.env.NODE_ENV === 'production',
});
try {
  console.log({
    ...(await runWorker(db, process.env)),
    account_email: await deliverAccountEmails(db, process.env),
  });
} finally {
  await db.close();
}
