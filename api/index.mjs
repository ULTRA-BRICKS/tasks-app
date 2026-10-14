import { trackSlackTransactions } from '../packages/server/modules/integrations/slack-wake.mjs';
import { withSlackWake } from '../packages/server/modules/integrations/slack-delivery.mjs';
import { withMcp } from '../packages/mcp/handler.mjs';
import { waitUntil } from '@vercel/functions';
import { createDatabase } from '../packages/db/index.mjs';
import { applicationOrigin } from '../packages/config/development.mjs';
import { createApp } from '../packages/server/app.mjs';
import { withLinear } from '../packages/linear/handler.mjs';
// This assembly is shared by the deployed initializer and isolated HTTP acceptance tests.
export function createApplication({ db, env, ...options }) {
  db = trackSlackTransactions(db);
  return withSlackWake(
    withMcp(withLinear(createApp({ db, env, ...options }), { db, env }), { db, env }),
    {
      db,
      env,
      defer: options.defer,
      send: options.slackQueueSend,
      clock: options.slackDeliveryClock,
      logger: options.logger,
    },
  );
}
async function initialize(environment) {
  const env = { ...environment, NODE_ENV: 'production' };
  applicationOrigin(env);
  if (!env.DATABASE_URL || !env.AUTH_SECRET || env.AUTH_SECRET.length < 32)
    throw new Error('Production configuration incomplete');
  const db = await createDatabase({ url: env.DATABASE_URL, production: true });
  try {
    return createApplication({ db, env, defer: waitUntil });
  } catch (error) {
    await db.close();
    throw error;
  }
}
export function createVercelHandler(environment = process.env) {
  let appPromise;
  return {
    async fetch(request) {
      try {
        appPromise ??= initialize(environment);
        return await (await appPromise).fetch(request);
      } catch {
        appPromise = undefined;
        const readiness =
          request.method === 'GET' &&
          new URL(request.url).pathname.replace(/\/$/, '') === '/api/ready';
        return Response.json(
          readiness
            ? { status: 'not_ready', code: 'PRODUCTION_CONFIG_REQUIRED' }
            : {
                error: {
                  code: 'NOT_CONFIGURED',
                  message: 'Production configuration is incomplete',
                },
              },
          { status: 503, headers: { 'cache-control': 'no-store' } },
        );
      }
    },
  };
}
export default createVercelHandler();
