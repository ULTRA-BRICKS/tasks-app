/** Queue wakes drain the durable Slack outbox; payloads contain only job identities. */
import { handleCallback } from '@vercel/queue';
import { createDatabase } from '../packages/db/index.mjs';
import { processSlackMessage } from '../packages/server/modules/integrations/slack-delivery.mjs';
let database;
export default {
  fetch: handleCallback(
    async (message) => {
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(message?.jobId ?? ''))
        throw Error('Invalid queue identity');
      database ??= await createDatabase({ url: process.env.DATABASE_URL, production: true });
      await processSlackMessage(database, process.env, message, { deadline: Date.now() + 40000 });
    },
    {
      visibilityTimeoutSeconds: 90,
      retry: (error) => ({ afterSeconds: Math.min(604799, error.retryAfterSeconds ?? 30) }),
    },
  ),
};
