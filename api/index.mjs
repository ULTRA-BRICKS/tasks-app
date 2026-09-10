import { createDatabase } from '../packages/db/index.mjs';
import { createApp } from '../packages/server/app.mjs';
import { withLinear } from '../packages/linear/handler.mjs';
let appPromise;
export default {
  async fetch(request) {
    try {
      appPromise ??= createDatabase({ url: process.env.DATABASE_URL, production: true }).then(
        (db) => withLinear(createApp({ db }), { db }),
      );
      return await (await appPromise).fetch(request);
    } catch {
      appPromise = undefined;
      return Response.json(
        { error: { code: 'NOT_CONFIGURED', message: 'Production configuration is incomplete' } },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      );
    }
  },
};
