import { waitUntil } from '@vercel/functions';
import { createDatabase } from '../packages/db/index.mjs';
import { applicationOrigin } from '../packages/config/development.mjs';
import { createApp } from '../packages/server/app.mjs';
import { withLinear } from '../packages/linear/handler.mjs';
async function initialize(environment) {
  const env = { ...environment, NODE_ENV: 'production' };
  applicationOrigin(env);
  if (!env.DATABASE_URL || !env.AUTH_SECRET || env.AUTH_SECRET.length < 32)
    throw new Error('Production configuration incomplete');
  const db = await createDatabase({ url: env.DATABASE_URL, production: true });
  try {
    return withLinear(createApp({ db, env, defer: waitUntil }), { db, env });
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
