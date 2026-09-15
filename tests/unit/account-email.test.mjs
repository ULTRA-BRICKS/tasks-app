import assert from 'node:assert/strict';
import { test, expect } from 'bun:test';
import { fixture } from './helpers.mjs';
import {
  encryptMail,
  decryptMail,
  createResendTransport,
  emailConfiguration,
} from '../../packages/server/modules/email/resend.mjs';
import {
  enqueueAccountEmail,
  deliverAccountEmails,
} from '../../packages/server/modules/email/service.mjs';
const env = {
  APP_URL: 'http://localhost:5173',
  AUTH_SECRET: 'test-mail-key-material'.repeat(3),
  MAIL_FROM: 'Tasks <test@example.test>',
  RESEND_API_KEY: 'test-only-provider-key',
};

test('mail payload encryption is authenticated and bound to its job', () => {
  const payload = { text: 'Synthetic one-time message', to: ['recipient@example.test'] };
  const encrypted = encryptMail(payload, env.AUTH_SECRET, 'job-one');
  expect(encrypted).not.toContain(payload.text);
  expect(decryptMail(encrypted, env.AUTH_SECRET, 'job-one')).toEqual(payload);
  expect(() => decryptMail(encrypted, env.AUTH_SECRET, 'job-two')).toThrow();
  expect(() => decryptMail(encrypted, 'different-key-material'.repeat(3), 'job-one')).toThrow();
});

test('Resend transport fixes endpoint, recipient payload and idempotency key', async () => {
  let sent;
  const transport = createResendTransport(env, async (url, options) => {
    sent = { url, options };
    return Response.json({ id: 'accepted-test-message' });
  });
  const payload = {
    from: env.MAIL_FROM,
    to: ['recipient@example.test'],
    subject: 'Synthetic test',
    text: 'Content',
  };
  expect(await transport(payload, 'test-job')).toEqual({ id: 'accepted-test-message' });
  expect(sent.url).toBe('https://api.resend.com/emails');
  expect(sent.options.redirect).toBe('error');
  expect(sent.options.headers['Idempotency-Key']).toBe('tasks-account/test-job');
  expect(JSON.parse(sent.options.body)).toEqual(payload);
});

test('provider failures are classified without exposing provider response bodies', async () => {
  const transient = createResendTransport(
    env,
    async () => new Response('private provider detail', { status: 429 }),
  );
  await assert.rejects(() => transient({}, 'retry'), {
    code: 'MAIL_HTTP_429',
    retryable: true,
  });
  const permanent = createResendTransport(
    env,
    async () => new Response('private provider detail', { status: 403 }),
  );
  await assert.rejects(() => permanent({}, 'reject'), {
    code: 'MAIL_HTTP_403',
    retryable: false,
  });
  expect(emailConfiguration({ ...env, MAIL_FROM: 'bad\r\nheader' }).configured).toBe(false);
  expect(emailConfiguration({ ...env, RESEND_API_KEY: '' }).configured).toBe(false);
});

test('durable mail jobs are claimed once and scrubbed after provider acceptance', async () => {
  const f = await fixture(env);
  try {
    const job = await f.db.transaction((tx) =>
      enqueueAccountEmail(tx, f.env, {
        kind: 'password_changed',
        userId: f.init.user_id,
        to: 'owner@example.test',
        subject: 'Test notification',
        text: 'No password in this email',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      }),
    );
    let sends = 0;
    const transport = async () => {
      sends++;
      return { id: 'provider-test-id' };
    };
    await Promise.all([
      deliverAccountEmails(f.db, f.env, { transport }),
      deliverAccountEmails(f.db, f.env, { transport }),
    ]);
    expect(sends).toBe(1);
    const row = await f.db.transaction((tx) =>
      tx.one('SELECT status,payload,provider_id FROM account_email_jobs WHERE id=?', [job]),
    );
    expect(row).toEqual({ status: 'sent', payload: null, provider_id: 'provider-test-id' });
  } finally {
    await f.close();
  }
});

test('retry retains the original mail and idempotency key, expired jobs are not sent', async () => {
  const f = await fixture(env);
  try {
    const job = await f.db.transaction((tx) =>
      enqueueAccountEmail(tx, f.env, {
        kind: 'password_changed',
        userId: f.init.user_id,
        to: 'owner@example.test',
        subject: 'Retry',
        text: 'Same message',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      }),
    );
    const attempts = [];
    const transport = async (message, key) => {
      attempts.push({ message, key });
      if (attempts.length === 1)
        throw Object.assign(new Error('timeout'), { code: 'MAIL_NETWORK', retryable: true });
      return { id: 'retried-message' };
    };
    await deliverAccountEmails(f.db, f.env, { transport });
    await f.db.transaction((tx) =>
      tx.exec('UPDATE account_email_jobs SET available_at=? WHERE id=?', [
        '2000-01-01T00:00:00.000Z',
        job,
      ]),
    );
    await deliverAccountEmails(f.db, f.env, { transport });
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(attempts[1]);
    await f.db.transaction((tx) =>
      enqueueAccountEmail(tx, f.env, {
        kind: 'password_changed',
        to: 'owner@example.test',
        subject: 'Expired',
        text: 'Do not send',
        expiresAt: '2000-01-01T00:00:00.000Z',
      }),
    );
    await deliverAccountEmails(f.db, f.env, { transport });
    expect(attempts).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test('expired encrypted payloads are scrubbed after the sender is disabled', async () => {
  const f = await fixture(env);
  try {
    const job = await f.db.transaction((tx) =>
      enqueueAccountEmail(tx, f.env, {
        kind: 'password_changed',
        to: 'owner@example.test',
        subject: 'Expired synthetic notification',
        text: 'This test message must never be delivered',
        expiresAt: '2000-01-01T00:00:00.000Z',
      }),
    );
    let calls = 0;
    const result = await deliverAccountEmails(
      f.db,
      { ...f.env, RESEND_API_KEY: '' },
      {
        transport: async () => {
          calls++;
          return { id: 'must-not-send' };
        },
      },
    );
    expect(result).toEqual({ configured: false, sent: 0, deferred: 0 });
    expect(calls).toBe(0);
    expect(
      await f.db.transaction((tx) =>
        tx.one('SELECT status,payload FROM account_email_jobs WHERE id=?', [job]),
      ),
    ).toEqual({ status: 'expired', payload: null });
  } finally {
    await f.close();
  }
});

test('a job cancelled between selection and claim is not resurrected', async () => {
  const f = await fixture(env);
  try {
    const job = await f.db.transaction((tx) =>
      enqueueAccountEmail(tx, f.env, {
        kind: 'password_changed',
        to: 'owner@example.test',
        subject: 'Queue race fixture',
        text: 'Never delivered',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      }),
    );
    await f.db.transaction(async (tx) => {
      await tx.exec('UPDATE account_email_jobs SET created_at=? WHERE id=?', [
        '2000-01-01T00:00:00.000Z',
        job,
      ]);
      await enqueueAccountEmail(tx, f.env, {
        kind: 'password_changed',
        to: 'owner@example.test',
        subject: 'Next valid job',
        text: 'Deliver this one',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });
    });
    let interrupted = false,
      deliveries = 0;
    const racingDb = {
      transaction: (fn, options) =>
        f.db.transaction(
          (tx) =>
            fn({
              ...tx,
              one: async (sql, args) => {
                const row = await tx.one(sql, args);
                if (
                  !interrupted &&
                  row?.id === job &&
                  sql.startsWith('SELECT * FROM account_email_jobs')
                ) {
                  interrupted = true;
                  await tx.exec(
                    "UPDATE account_email_jobs SET status='expired',payload=NULL WHERE id=?",
                    [job],
                  );
                }
                return row;
              },
            }),
          options,
        ),
    };
    await deliverAccountEmails(racingDb, f.env, {
      transport: async (message) => {
        expect(message.subject).toBe('Next valid job');
        deliveries++;
        return { id: 'next-valid-job' };
      },
    });
    expect(interrupted).toBe(true);
    expect(deliveries).toBe(1);
    expect(
      await f.db.transaction((tx) =>
        tx.one('SELECT status,payload,attempts FROM account_email_jobs WHERE id=?', [job]),
      ),
    ).toEqual({ status: 'expired', payload: null, attempts: 0 });
  } finally {
    await f.close();
  }
});
