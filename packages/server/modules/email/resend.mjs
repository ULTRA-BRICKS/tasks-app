import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { applicationOrigin } from '../../../config/development.mjs';

export function emailConfiguration(env) {
  const from = env.MAIL_FROM?.trim() ?? '';
  const configured = Boolean(
    env.RESEND_API_KEY &&
    env.AUTH_SECRET?.length >= 32 &&
    /^[^\r\n]*[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(from),
  );
  return { configured, from, origin: applicationOrigin(env) };
}
function key(secret) {
  if (!secret || secret.length < 32) throw new Error('Account mail key unavailable');
  return createHash('sha256')
    .update('tickets-account-mail-v1\0' + secret)
    .digest();
}
export function encryptMail(payload, secret, jobId) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  cipher.setAAD(Buffer.from(jobId));
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((x) => x.toString('base64url')).join('.');
}
export function decryptMail(encoded, secret, jobId) {
  const parts = String(encoded).split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted mail');
  const [iv, tag, body] = parts.map((x) => Buffer.from(x, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', key(secret), iv);
  decipher.setAAD(Buffer.from(jobId));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'));
}
export function createResendTransport(env, fetcher = fetch) {
  return async (message, jobId) => {
    if (!emailConfiguration(env).configured)
      throw Object.assign(new Error('Mail is not configured'), {
        code: 'MAIL_NOT_CONFIGURED',
        retryable: false,
      });
    let response;
    try {
      response = await fetcher('https://api.resend.com/emails', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: 'Bearer ' + env.RESEND_API_KEY,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'tasks-account/' + jobId,
        },
        body: JSON.stringify(message),
      });
    } catch {
      throw Object.assign(new Error('Email request could not be confirmed'), {
        code: 'MAIL_NETWORK',
        retryable: true,
      });
    }
    if (!response.ok) {
      // Do not log provider bodies: they can echo an address, key or reset URL.
      throw Object.assign(new Error('Email provider rejected the request'), {
        code: 'MAIL_HTTP_' + response.status,
        retryable: response.status === 429 || response.status === 409 || response.status >= 500,
      });
    }
    let body;
    try {
      body = await response.json();
    } catch {}
    if (typeof body?.id !== 'string' || body.id.length > 128)
      throw Object.assign(new Error('Email acceptance could not be confirmed'), {
        code: 'MAIL_RESPONSE',
        retryable: true,
      });
    return { id: body.id };
  };
}
