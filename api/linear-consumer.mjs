import { handleCallback } from '@vercel/queue';
import { createDatabase } from '../packages/db/index.mjs';
import { processLinearMessage } from '../packages/server/modules/linear-live/dispatch.mjs';
import { uuid } from '../packages/imports/linear-source.mjs';
let database;
export default {
  fetch: handleCallback(
    async (message) => {
      if (!uuid(message?.jobId) || !uuid(message?.generation))
        throw Error('Invalid queue identity');
      database ??= await createDatabase({ url: process.env.DATABASE_URL, production: true });
      await processLinearMessage(database, process.env, message, { deadline: Date.now() + 45000 });
    },
    {
      visibilityTimeout: 90,
      retry: (_error, metadata) => ({
        afterSeconds: Math.min(300, Math.max(15, 2 ** Math.min(metadata.deliveryCount, 6) * 5)),
      }),
    },
  ),
};
