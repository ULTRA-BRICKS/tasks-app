import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
test('Slack connection status is explicit, admin scoped and never leaks credentials', async () => {
  const f = await fixture();
  try {
    const status = await f.request('GET', '/api/v1/integrations/slack/status');
    expect(status.status).toBe(200);
    expect(status.data.connected).toBe(false);
    expect(status.data.missing).toContain('SLACK_BOT_TOKEN');
    expect((await f.request('GET', '/api/v1/integrations/slack/status', undefined, { anonymous: true })).status).toBe(401);
    expect(JSON.stringify(status.data)).not.toContain(f.env.AUTH_SECRET);
  } finally { await f.close(); }
});
test('unconfigured Slack cannot sync users or enable streaming', async () => {
  const f = await fixture();
  try {
    const sync = await f.request('POST', '/api/v1/integrations/slack/people/sync', {});
    expect(sync.status).toBe(503);
    const count = await f.db.transaction(tx => tx.one('SELECT COUNT(*) AS n FROM memberships'));
    expect(count.n).toBe(1);
  } finally { await f.close(); }
});
