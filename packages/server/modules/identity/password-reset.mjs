import { setTimeout as delay } from 'node:timers/promises';
import { assert } from '../../core/errors.mjs';
import { hashPassword, secret, sha256, now, constantEqual } from '../../core/crypto.mjs';
import { rateLimit } from './service.mjs';
import { emailConfiguration, enqueueAccountEmail } from '../email/service.mjs';
export const resetAccepted = Object.freeze({
  ok: true,
  message: 'If an account exists for this email, a reset link will be sent shortly.',
});
export async function requestPasswordReset(db, env, input, source) {
  const config = emailConfiguration(env),
    started = performance.now();
  assert(
    config.configured,
    503,
    'MAIL_NOT_CONFIGURED',
    'Account email is not configured. Contact the workspace owner.',
  );
  const email = input.email.trim().toLowerCase();
  try {
    await db.transaction(async (tx) => {
      await tx.lock('auth-rate-limit');
      const sourceAllowed = await rateLimit(tx, 'reset-source:' + sha256(source), 20, 900);
      if (!sourceAllowed) return;
      const accountAllowed = await rateLimit(tx, 'reset-account:' + sha256(email), 3, 3600);
      if (!accountAllowed) return;
      const user = await tx.one(
        'SELECT u.id,u.email,u.password_hash FROM users u WHERE u.email=? AND EXISTS (SELECT 1 FROM memberships m WHERE m.user_id=u.id)',
        [email],
      );
      if (!user) return;
      await tx.lock('identity:user:' + user.id);
      const token = secret(),
        hash = sha256(token),
        expiresAt = new Date(Date.now() + 30 * 60000).toISOString();
      await tx.exec(
        'INSERT INTO password_reset_tokens(hash,user_id,password_fingerprint,expires_at,created_at) VALUES(?,?,?,?,?)',
        [hash, user.id, sha256(user.password_hash), expiresAt, now()],
      );
      const url = new URL('/reset-password', config.origin);
      url.hash = new URLSearchParams({ token }).toString();
      await enqueueAccountEmail(tx, env, {
        kind: 'password_reset',
        userId: user.id,
        resetHash: hash,
        to: user.email,
        subject: 'Reset your Tasks password',
        expiresAt,
        text: `A password reset was requested for your Tasks account.\n\nChoose a new password: ${url.href}\n\nThis single-use link expires in 30 minutes. Nothing changes unless you submit a new password. If you did not request it, ignore this email.\n`,
      });
    });
  } finally {
    await delay(Math.max(0, 250 - (performance.now() - started)));
  }
  return resetAccepted;
}
export async function resetPassword(db, env, input, source) {
  assert(
    /^[A-Za-z0-9_-]{43}$/.test(input.token ?? '') &&
      typeof input.password === 'string' &&
      input.password.length >= 12 &&
      input.password.length <= 256,
    422,
    'INVALID_RESET_INPUT',
    'Use a valid reset link and a password of 12–256 characters.',
  );
  const allowed = await db.transaction(async (tx) => {
    await tx.lock('auth-rate-limit');
    return rateLimit(tx, 'reset-consume:' + sha256(source), 20, 900);
  });
  assert(allowed, 429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
  const hash = sha256(input.token);
  const proof = await db.transaction(
    (tx) =>
      tx.one(
        'SELECT * FROM password_reset_tokens WHERE hash=? AND used_at IS NULL AND expires_at>?',
        [hash, now()],
      ),
    { readOnly: true },
  );
  assert(
    proof,
    410,
    'RESET_LINK_INVALID',
    'This reset link is invalid, expired, or already used. Request a new one.',
  );
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    await tx.lock('identity:user:' + proof.user_id);
    const current = await tx.one(
      'SELECT * FROM password_reset_tokens WHERE hash=? AND used_at IS NULL AND expires_at>?',
      [hash, now()],
    );
    const user = await tx.one('SELECT id,email,password_hash FROM users WHERE id=?', [
      proof.user_id,
    ]);
    assert(
      current && user && constantEqual(current.password_fingerprint, sha256(user.password_hash)),
      410,
      'RESET_LINK_INVALID',
      'This reset link is invalid, expired, or already used. Request a new one.',
    );
    await tx.exec('UPDATE users SET password_hash=? WHERE id=?', [passwordHash, user.id]);
    await tx.exec(
      'UPDATE password_reset_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL',
      [now(), user.id],
    );
    await tx.exec('DELETE FROM sessions WHERE user_id=?', [user.id]);
    await tx.exec('DELETE FROM api_tokens WHERE user_id=?', [user.id]);
    await tx.exec(
      "UPDATE account_email_jobs SET status='expired',payload=NULL WHERE user_id=? AND kind='password_reset' AND status IN ('pending','sending')",
      [user.id],
    );
    await enqueueAccountEmail(tx, env, {
      kind: 'password_changed',
      userId: user.id,
      to: user.email,
      expiresAt: new Date(Date.now() + 12 * 3600000).toISOString(),
      subject: 'Your Tasks password was changed',
      text: `Your Tasks password was changed. All existing sign-in sessions and personal API tokens were revoked.\n\nSign in at ${emailConfiguration(env).origin}/login\n\nIf you did not do this, request a new reset link and contact your workspace owner.\n`,
    });
    return { ok: true };
  });
}
