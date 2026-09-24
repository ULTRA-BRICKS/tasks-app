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

test('email invitation retries enqueue one message and never return its one-time proof', async () => {
  const f = await fixture(mail);
  try {
    const input = { email: 'retry@example.test', role: 'member', delivery: 'email' };
    const headers = { 'idempotency-key': 'invite-test-unique-key-24' };
    const first = await f.request('POST', '/api/v1/invitations', input, { headers });
    const again = await f.request('POST', '/api/v1/invitations', input, { headers });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(first.data).toEqual(again.data);
    expect(first.data.token).toBeUndefined();
    expect(
      (await f.db.transaction((tx) => tx.one('SELECT COUNT(*) AS n FROM invitations'))).n,
    ).toBe(1);
    expect(
      (await f.db.transaction((tx) => tx.one('SELECT COUNT(*) AS n FROM account_email_jobs'))).n,
    ).toBe(1);
  } finally {
    await f.close();
  }
});
