import { setTimeout as sleep } from 'node:timers/promises';
import { createDatabase } from '../packages/db/index.mjs';
import { productionEnvironment } from '../packages/server/production-runtime.mjs';
import {
  runPostgresLinearTick,
  scheduleDailyReconciliation,
} from '../packages/server/modules/linear-live/postgres-worker.mjs';
import { runWorker } from '../packages/server/modules/integrations/service.mjs';
import { deliverAccountEmails } from '../packages/server/modules/email/service.mjs';
import { inspectReadiness } from '../packages/server/readiness.mjs';

const env = productionEnvironment(process.env);
const db = await createDatabase({ url: env.DATABASE_URL, production: true });
const abort = new AbortController();
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    stopping = true;
    abort.abort();
  });
try {
  while (!stopping) {
    try {
      const ready = await inspectReadiness(db);
      if (ready.status !== 'ready')
        throw Object.assign(new Error(), { code: 'DATABASE_NOT_READY' });
      if (env.LINEAR_SYNC_WORKSPACE_ID) await scheduleDailyReconciliation(db, env);
      const linear = env.LINEAR_SYNC_WORKSPACE_ID
        ? await runPostgresLinearTick(db, env, { limit: 5 })
        : { processed: 0 };
      if (!stopping) await runWorker(db, env, { limit: 5 });
      if (!stopping) await deliverAccountEmails(db, env, { limit: 5 });
      if (linear.processed) console.log(JSON.stringify({ event: 'linear-worker-tick', ...linear }));
    } catch (error) {
      const code =
        typeof error.code === 'string' && /^[A-Z_]{1,60}$/.test(error.code)
          ? error.code
          : 'WORKER_TICK_FAILED';
      console.error(JSON.stringify({ code }));
    }
    if (!stopping) await sleep(2000, undefined, { signal: abort.signal }).catch(() => {});
  }
} finally {
  await db.close();
}
