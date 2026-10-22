import { applicationOrigin } from '../config/development.mjs';
import { createDatabase } from '../db/index.mjs';
import { withLinear } from '../linear/handler.mjs';
import { withMcp } from '../mcp/handler.mjs';
import { createApp } from './app.mjs';
import { createPublicApp } from './public-app.mjs';
import { syncDeploymentId, linearQueueDriver } from './modules/linear-live/runtime.mjs';

export function productionEnvironment(input) {
  const env = {
    ...input,
    NODE_ENV: 'production',
    LINEAR_QUEUE_DRIVER: input.LINEAR_QUEUE_DRIVER || 'postgres',
  };
  applicationOrigin(env);
  if (!env.DATABASE_URL || !/^postgres(ql)?:\/\//.test(env.DATABASE_URL))
    throw new Error('A PostgreSQL DATABASE_URL is required');
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32)
    throw new Error('A stable production AUTH_SECRET is required');
  if (!env.TASKS_DEPLOYMENT_ID || !/^[A-Za-z0-9._-]{1,160}$/.test(env.TASKS_DEPLOYMENT_ID))
    throw new Error('An explicit TASKS_DEPLOYMENT_ID is required');
  syncDeploymentId(env);
  if (env.VERCEL || linearQueueDriver(env) !== 'postgres')
    throw new Error('Self-hosted runtime requires PostgreSQL queue mode');
  return env;
}
export async function createProductionRuntime(environment, publicDirectory) {
  const env = productionEnvironment(environment);
  const db = await createDatabase({ url: env.DATABASE_URL, production: true });
  const background = new Set();
  const defer = (promise) => {
    const tracked = promise.catch(() => console.error({ code: 'BACKGROUND_RETRY_REQUIRED' }));
    background.add(tracked);
    void tracked.finally(() => background.delete(tracked));
  };
  try {
    const domain = withMcp(withLinear(createApp({ db, env, defer }), { db, env }), { db, env });
    const app = await createPublicApp(domain, publicDirectory);
    return {
      ...app,
      async close() {
        await Promise.allSettled([...background]);
        await db.close();
      },
    };
  } catch (error) {
    await db.close();
    throw error;
  }
}
