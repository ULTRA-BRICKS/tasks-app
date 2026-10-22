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
    const stage = async (run) => {
      try {
        return await run();
      } catch (error) {
        const code =
          typeof error.code === 'string' && /^[A-Z_]{1,60}$/.test(error.code)
            ? error.code
            : 'WORKER_TICK_FAILED';
        console.error(JSON.stringify({ code }));
        return undefined;
      }
    };
    const ready = await stage(() => inspectReadiness(db));
    if (ready?.status === 'ready') {
      if (env.LINEAR_SYNC_WORKSPACE_ID) await stage(() => scheduleDailyReconciliation(db, env));
      const linear = env.LINEAR_SYNC_WORKSPACE_ID
        ? await stage(() => runPostgresLinearTick(db, env, { limit: 5 }))
        : undefined;
      if (!stopping) await stage(() => runWorker(db, env, { limit: 5 }));
      if (!stopping) await stage(() => deliverAccountEmails(db, env, { limit: 5 }));
      if (linear?.processed || linear?.failed)
        console.log(JSON.stringify({ event: 'linear-worker-tick', ...linear }));
    } else if (ready) console.error(JSON.stringify({ code: 'DATABASE_NOT_READY' }));
    if (!stopping) await sleep(2000, undefined, { signal: abort.signal }).catch(() => {});
  }
} finally {
  await db.close();
}
