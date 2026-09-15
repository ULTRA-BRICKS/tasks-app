import { id, now } from '../../core/crypto.mjs';
import { assert } from '../../core/errors.mjs';
import { createResendTransport, decryptMail, encryptMail, emailConfiguration } from './resend.mjs';
export { emailConfiguration } from './resend.mjs';

export async function enqueueAccountEmail(
  tx,
  env,
  { kind, userId = null, workspaceId = null, resetHash = null, to, subject, text, expiresAt },
) {
  const config = emailConfiguration(env);
  assert(
    config.configured,
    503,
    'MAIL_NOT_CONFIGURED',
    'Account email is not configured. Contact the workspace owner.',
  );
  const jobId = id();
  const payload = encryptMail(
    { from: config.from, to: [to], subject, text },
    env.AUTH_SECRET,
    jobId,
  );
  await tx.exec(
    "INSERT INTO account_email_jobs(id,kind,user_id,workspace_id,reset_hash,payload,status,available_at,expires_at,created_at) VALUES(?,?,?,?,?,?,'pending',?,?,?)",
    [jobId, kind, userId, workspaceId, resetHash, payload, now(), expiresAt, now()],
  );
  return jobId;
}
export async function deliverAccountEmails(
  db,
  env,
  { transport = createResendTransport(env), limit = 3 } = {},
) {
  // Expiry is a privacy obligation even if the sender has been disabled.
  await db.transaction(async (tx) => {
    await tx.lock('tickets:account-email-queue');
    await tx.exec(
      "UPDATE account_email_jobs SET status='expired',payload=NULL WHERE status IN ('pending','sending') AND expires_at<=?",
      [now()],
    );
  });
  if (!emailConfiguration(env).configured) return { configured: false, sent: 0, deferred: 0 };
  const result = { configured: true, sent: 0, deferred: 0 };
  for (let i = 0; i < Math.min(3, Math.max(0, limit)); i++) {
    const job = await db.transaction(async (tx) => {
      await tx.lock('tickets:account-email-queue');
      const time = now();
      const candidate = await tx.one(
        "SELECT * FROM account_email_jobs WHERE payload IS NOT NULL AND expires_at>? AND available_at<=? AND (status='pending' OR (status='sending' AND lease_until<=?)) ORDER BY created_at,id LIMIT 1",
        [time, time, time],
      );
      if (!candidate) return null;
      const lease = new Date(Date.now() + 45000).toISOString();
      const claimed = await tx.exec(
        "UPDATE account_email_jobs SET status='sending',attempts=attempts+1,lease_until=? WHERE id=? AND payload IS NOT NULL AND expires_at>? AND available_at<=? AND (status='pending' OR (status='sending' AND lease_until<=?))",
        [lease, candidate.id, time, time, time],
      );
      if (claimed.changes !== 1) return false;
      return { ...candidate, attempts: candidate.attempts + 1, lease_until: lease };
    });
    if (job === null) break;
    if (job === false) continue;
    try {
      if (job.reset_hash) {
        const active = await db.transaction(
          (tx) =>
            tx.one(
              'SELECT hash FROM password_reset_tokens WHERE hash=? AND used_at IS NULL AND expires_at>?',
              [job.reset_hash, now()],
            ),
          { readOnly: true },
        );
        if (!active) {
          await db.transaction((tx) =>
            tx.exec(
              "UPDATE account_email_jobs SET status='expired',payload=NULL WHERE id=? AND lease_until=? AND status='sending'",
              [job.id, job.lease_until],
            ),
          );
          continue;
        }
      }
      const sent = await transport(decryptMail(job.payload, env.AUTH_SECRET, job.id), job.id);
      if (!sent?.id) throw new Error('Mail response missing');
      await db.transaction((tx) =>
        tx.exec(
          "UPDATE account_email_jobs SET status='sent',payload=NULL,provider_id=?,last_error=NULL,lease_until=NULL WHERE id=? AND lease_until=? AND status='sending'",
          [sent.id, job.id, job.lease_until],
        ),
      );
      result.sent++;
    } catch (error) {
      const retry = error.retryable === true && job.attempts < 5;
      const code = /^MAIL_(HTTP_[0-9]{3}|NETWORK|RESPONSE|NOT_CONFIGURED)$/.test(error.code ?? '')
        ? error.code
        : 'MAIL_FAILED';
      await db.transaction((tx) =>
        tx.exec(
          "UPDATE account_email_jobs SET status=?,payload=?,last_error=?,available_at=?,lease_until=NULL WHERE id=? AND lease_until=? AND status='sending'",
          [
            retry ? 'pending' : 'failed',
            retry ? job.payload : null,
            code,
            new Date(Date.now() + Math.min(600000, 30000 * 2 ** (job.attempts - 1))).toISOString(),
            job.id,
            job.lease_until,
          ],
        ),
      );
      result.deferred++;
    }
  }
  return result;
}
