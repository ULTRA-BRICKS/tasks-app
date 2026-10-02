import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
import { deliverAccountEmails } from '../../packages/server/modules/email/service.mjs';
const mail = {
  MAIL_FROM: 'Tasks <security@example.test>',
  RESEND_API_KEY: 'synthetic-fixture-key',
};
test('People API lists invitations with acceptance state, never hashes or secret links', async () => {
  const f = await fixture(mail);
  try {
    const invitation = await f.request('POST', '/api/v1/invitations', {
      email: 'invitee@example.test',
      role: 'member',
    });
    expect(invitation.status).toBe(201);
    expect(invitation.data.email_queued).toBe(true);
    const result = await f.request('GET', '/api/v1/invitations');
    expect(result.status).toBe(200);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ email: 'invitee@example.test', status: 'pending' });
    expect(JSON.stringify(result.data)).not.toContain(invitation.data.token);
    expect(result.data[0].hash).toBeUndefined();
    const sent = [];
    await deliverAccountEmails(f.db, f.env, {
      transport: async (message, id) => {
        sent.push(message);
        return { id };
      },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['invitee@example.test']);
    expect(
      (await f.request('GET', '/api/v1/invitations', undefined, { anonymous: true })).status,
    ).toBe(401);
  } finally {
    await f.close();
  }
});
test('email-only invitation fails atomically when no sender exists', async () => {
  const f = await fixture();
  try {
    const result = await f.request('POST', '/api/v1/invitations', {
      email: 'no-sender@example.test',
      role: 'member',
      delivery: 'email',
    });
    expect(result.status).toBe(503);
    expect(
      (await f.db.transaction((tx) => tx.one('SELECT COUNT(*) AS n FROM invitations'))).n,
    ).toBe(0);
  } finally {
    await f.close();
  }
});
