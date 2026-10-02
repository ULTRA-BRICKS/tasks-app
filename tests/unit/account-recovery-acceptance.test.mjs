import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
import { deliverAccountEmails } from '../../packages/server/modules/email/service.mjs';

// Uses only fixture()'s isolated test database and an in-memory mail transport.
// No production configuration is read and no external email request is made.
const mailSettings = {
  RESEND_API_KEY: 'test-only-not-a-provider-key',
  MAIL_FROM: 'Tasks <test@example.test>',
};
async function captureResetEmail(f) {
  const messages = [];
  await deliverAccountEmails(f.db, f.env, {
    transport: async (message) => {
      messages.push(message);
      return { id: 'synthetic-delivery-' + messages.length };
    },
  });
  expect(messages).toHaveLength(1);
  const link = new URL(messages[0].text.match(/http[^\s]+/)[0]);
  expect(link.origin).toBe(f.env.APP_URL);
  return new URLSearchParams(link.hash.slice(1)).get('token');
}
test('the ordinary reset HTTP flow consumes its mailed proof once and revokes the old session', async () => {
  const f = await fixture(mailSettings);
  try {
    const accepted = await f.request(
      'POST',
      '/api/auth/forgot-password',
      { email: 'owner@example.test' },
      { anonymous: true },
    );
    expect(accepted.status).toBe(202);
    const token = await captureResetEmail(f);
    const input = { token, password: 'new-local-fixture-password' };
    expect(
      (await f.request('POST', '/api/auth/reset-password', input, { anonymous: true })).status,
    ).toBe(200);
    expect((await f.request('GET', '/api/v1/me')).status).toBe(401);
    expect(
      (await f.request('POST', '/api/auth/reset-password', input, { anonymous: true })).status,
    ).toBe(410);
    expect(
      (
        await f.request(
          'POST',
          '/api/auth/login',
          { email: 'owner@example.test', password: input.password },
          { anonymous: true },
        )
      ).status,
    ).toBe(200);
  } finally {
    await f.close();
  }
});
