import { withSlackRequest } from './slack-wake.mjs';
/** Durable Slack delivery reached by workers, queue wakes and cron recovery.
 * Database leases serialize each configured workspace/channel; network receipts are persisted.
 * Ambiguous transport failures remain at-least-once, never claimed as exactly-once delivery.
 */
import { renderSlackNotification } from './slack-notifications.mjs';
import { id } from '../../core/crypto.mjs';
import {
  activationKey,
  gateKey,
  deliveryLock,
  isSlackPreview,
  slackJsonField,
} from './slack-state.mjs';

const stamp = (time) => new Date(time).toISOString();
const terminal = ['done', 'failed', 'suppressed'];
async function destinationMatches(tx, env) {
  const activation = await tx.one('SELECT payload FROM outbox WHERE id=? AND workspace_id=?', [
    activationKey(env.INTEGRATIONS_WORKSPACE_ID),
    env.INTEGRATIONS_WORKSPACE_ID,
  ]);
  return !activation || JSON.parse(activation.payload).channel === env.SLACK_CHANNEL_ID;
}
export async function runSlackDelivery(
  db,
  env,
  {
    limit = 20,
    fetcher = fetch,
    clock = Date.now,
    deadline = clock() + 40000,
    jobId,
    waitForPacing = false,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {},
) {
  const result = { processed: 0, failed: 0 };
  if (
    isSlackPreview(env) ||
    !env.INTEGRATIONS_WORKSPACE_ID ||
    !env.SLACK_CHANNEL_ID ||
    !env.SLACK_BOT_TOKEN
  )
    return result;
  for (let n = 0; n < limit && clock() < deadline; n++) {
    const job = await db
      .transaction(
        async (tx) => {
          if (clock() >= deadline) return null;
          await tx.lock(deliveryLock(env.INTEGRATIONS_WORKSPACE_ID));
          if (!(await destinationMatches(tx, env))) return null;
          const scope = `workspace_id=? AND provider='slack' AND (${slackJsonField(tx, 'channel')} IS NULL OR ${slackJsonField(tx, 'channel')}=?)${jobId ? ' AND id=?' : ''}`;
          const args = [
            env.INTEGRATIONS_WORKSPACE_ID,
            env.SLACK_CHANNEL_ID,
            ...(jobId ? [jobId] : []),
          ];
          await tx.exec(
            `UPDATE outbox SET status='failed',last_error='SLACK_ATTEMPTS_EXHAUSTED' WHERE ${scope} AND status IN ('pending','processing') AND attempts>=5 AND next_attempt_at<=?`,
            [...args, stamp(clock())],
          );
          const row = await tx.one(
            `SELECT * FROM outbox WHERE ${scope} AND status IN ('pending','processing') AND attempts<5 AND next_attempt_at<=? ORDER BY created_at,id LIMIT 1`,
            [...args, stamp(clock())],
          );
          if (!row) return null;
          const gateId = gateKey(row.workspace_id, env.SLACK_CHANNEL_ID);
          const gate = await tx.one('SELECT next_attempt_at FROM outbox WHERE id=?', [gateId]);
          if (gate && gate.next_attempt_at > stamp(clock()))
            return { waitUntil: Date.parse(gate.next_attempt_at) };
          const lease = stamp(clock() + 30000);
          const owner = id();
          const payload = JSON.stringify({ ...JSON.parse(row.payload), _slack_lease: owner });
          await tx.exec(
            "INSERT INTO outbox(id,workspace_id,provider,event,payload,status,attempts,next_attempt_at,created_at) VALUES(?,?,'slack','gate',?,'lease',0,?,?) ON CONFLICT(id) DO UPDATE SET next_attempt_at=excluded.next_attempt_at,payload=excluded.payload",
            [gateId, row.workspace_id, JSON.stringify({ owner }), lease, stamp(clock())],
          );
          await tx.exec(
            "UPDATE outbox SET status='processing',attempts=attempts+1,next_attempt_at=?,payload=? WHERE id=?",
            [lease, payload, row.id],
          );
          return { ...row, payload, attempts: row.attempts + 1, gateId, lease, owner };
        },
        { timeoutMs: Math.max(1, deadline - clock()) },
      )
      .catch((error) => {
        if (error.code === 'DB_TRANSACTION_TIMEOUT') return null;
        throw error;
      });
    if (!job) break;
    if (job.waitUntil) {
      if (!waitForPacing || job.waitUntil >= deadline) break;
      await sleep(Math.max(1, job.waitUntil - clock()));
      n--;
      continue;
    }
    let outcome;
    try {
      outcome = await db.transaction(
        async (tx) => {
          // Policy changes use this workspace lock; once POST starts it cannot be recalled.
          if (tx.dialect === 'postgres') {
            await tx.exec("SET LOCAL lock_timeout = '10000ms'");
            await tx.exec("SET LOCAL statement_timeout = '10000ms'");
          }
          await tx.lock(job.workspace_id);
          await tx.lock(deliveryLock(job.workspace_id));
          const live = await tx.one(
            'SELECT status,attempts,next_attempt_at,payload FROM outbox WHERE workspace_id=? AND id=?',
            [job.workspace_id, job.id],
          );
          const gate = await tx.one(
            'SELECT next_attempt_at,payload FROM outbox WHERE workspace_id=? AND id=?',
            [job.workspace_id, job.gateId],
          );
          if (
            live?.status !== 'processing' ||
            live.attempts !== job.attempts ||
            live.next_attempt_at !== job.lease ||
            JSON.parse(live.payload)._slack_lease !== job.owner ||
            gate?.next_attempt_at !== job.lease ||
            JSON.parse(gate.payload).owner !== job.owner ||
            Date.parse(live.next_attempt_at) <= clock() ||
            clock() >= deadline
          )
            return null;
          let status = 'done',
            code = null,
            delay = 1,
            rateLimited = false,
            receipt;
          let renewed = job.lease;
          try {
            const check = await (async () => {
              if (job.workspace_id !== env.INTEGRATIONS_WORKSPACE_ID)
                return 'WORKSPACE_NOT_CONFIGURED';
              if (!env.SLACK_BOT_TOKEN || !env.SLACK_CHANNEL_ID) return 'SLACK_NOT_CONFIGURED';
              const settings = await tx.one(
                "SELECT enabled,config FROM module_settings WHERE workspace_id=? AND module='slack'",
                [job.workspace_id],
              );
              if (!settings?.enabled)
                return job.event === 'confirmation' ? 'MODULE_DISABLED' : 'SLACK_MODULE_DISABLED';
              if (job.event === 'confirmation') return null;
              const data = JSON.parse(job.payload);
              if (data.format !== 'tasks-slack-v1') return 'SLACK_LEGACY_EVENT';
              if (!JSON.parse(settings.config).notify) return 'SLACK_NOTIFY_DISABLED';
              const row = await tx.one('SELECT payload FROM outbox WHERE id=?', [
                activationKey(job.workspace_id),
              ]);
              const activation = row ? JSON.parse(row.payload) : null;
              if (
                !activation ||
                job.created_at < activation.activated_at ||
                data.activation_generation !== activation.generation
              )
                return 'SLACK_NOT_ACTIVATED';
              if (
                activation.channel !== env.SLACK_CHANNEL_ID ||
                data.channel !== env.SLACK_CHANNEL_ID
              )
                return 'SLACK_CHANNEL_CHANGED';
              return null;
            })();
            if (check?.startsWith('SLACK_') && check !== 'SLACK_NOT_CONFIGURED') {
              status = 'suppressed';
              code = check;
            } else {
              if (check) throw Object.assign(Error(check), { code: check });
              if (Date.parse(live.next_attempt_at) <= clock() || clock() >= deadline) return null;
              renewed = stamp(Math.min(deadline, clock() + 15000));
              await tx.exec(
                'UPDATE outbox SET next_attempt_at=? WHERE workspace_id=? AND id=? AND attempts=? AND next_attempt_at=?',
                [renewed, job.workspace_id, job.id, job.attempts, job.lease],
              );
              await tx.exec(
                'UPDATE outbox SET next_attempt_at=? WHERE workspace_id=? AND id=? AND next_attempt_at=?',
                [renewed, job.workspace_id, job.gateId, job.lease],
              );
              const signal = AbortSignal.timeout(
                Math.max(1, Math.min(10000, deadline - clock() - 100)),
              );
              let aborted;
              const timeout = new Promise((_, reject) => {
                aborted = () =>
                  reject(
                    Object.assign(Error('Slack request timed out'), { code: 'SLACK_UNREACHABLE' }),
                  );
                signal.addEventListener('abort', aborted, { once: true });
              });
              try {
                const providerResult = await Promise.race([
                  (async () => {
                    let status = 'done',
                      code = null,
                      delay = 1,
                      rateLimited = false,
                      receipt;
                    let response;
                    try {
                      response = await fetcher('https://slack.com/api/chat.postMessage', {
                        method: 'POST',
                        signal,
                        headers: {
                          authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
                          'content-type': 'application/json',
                        },
                        body: JSON.stringify({
                          channel: env.SLACK_CHANNEL_ID,
                          client_msg_id: job.id,
                          ...renderSlackNotification(job, env),
                          parse: 'none',
                          link_names: false,
                          unfurl_links: false,
                          unfurl_media: false,
                        }),
                      });
                    } catch {
                      throw Object.assign(Error('Slack transport failed'), {
                        code: 'SLACK_UNREACHABLE',
                      });
                    }
                    if (response.status === 429) {
                      const seconds = Number(response.headers.get('retry-after'));
                      delay =
                        Number.isFinite(seconds) &&
                        seconds > 0 &&
                        seconds * 1000 < 8640000000000000 - clock()
                          ? Math.max(1, seconds)
                          : 30;
                      rateLimited = true;
                      status = 'pending';
                      code = 'SLACK_RATE_LIMITED';
                    } else {
                      if (!response.ok)
                        throw Object.assign(Error('Slack HTTP failed'), {
                          code: `SLACK_HTTP_${response.status}`,
                        });
                      let body;
                      try {
                        body = await response.json();
                      } catch {
                        throw Object.assign(Error('Invalid receipt'), {
                          code: 'SLACK_RECEIPT_INVALID',
                          permanent: true,
                        });
                      }
                      if (!body.ok) {
                        const name = /^[a-z0-9_]{1,64}$/.test(body.error ?? '')
                          ? body.error
                          : 'UNKNOWN';
                        throw Object.assign(Error('Slack rejected delivery'), {
                          code: `SLACK_API_${name}`,
                          permanent: [
                            'invalid_auth',
                            'token_revoked',
                            'account_inactive',
                            'channel_not_found',
                            'not_in_channel',
                            'missing_scope',
                            'is_archived',
                          ].includes(name),
                        });
                      }
                      if (
                        body.channel !== env.SLACK_CHANNEL_ID ||
                        !/^[0-9]+\.[0-9]+$/.test(body.ts ?? '')
                      )
                        throw Object.assign(Error('Invalid receipt'), {
                          code: 'SLACK_RECEIPT_INVALID',
                          permanent: true,
                        });
                      receipt = { channel: body.channel, ts: body.ts };
                    }
                    return { status, code, delay, rateLimited, receipt };
                  })(),
                  timeout,
                ]);
                ({ status, code, delay, rateLimited, receipt } = providerResult);
              } finally {
                signal.removeEventListener('abort', aborted);
              }
            }
          } catch (error) {
            code = error.code ?? 'SLACK_DELIVERY_FAILED';
            status = error.permanent || job.attempts >= 5 ? 'failed' : 'pending';
            delay = Math.min(3600, 2 ** job.attempts * 15);
          }
          const data = JSON.parse(job.payload);
          delete data._slack_lease;
          if (receipt) data.receipt = receipt;
          const updated = await tx.exec(
            "UPDATE outbox SET status=?,attempts=?,next_attempt_at=?,last_error=?,payload=? WHERE id=? AND workspace_id=? AND status='processing' AND attempts=? AND next_attempt_at=?",
            [
              status,
              job.attempts - (rateLimited ? 1 : 0),
              stamp(clock() + delay * 1000),
              code,
              JSON.stringify(data),
              job.id,
              job.workspace_id,
              job.attempts,
              renewed,
            ],
          );
          if (Number(updated.changes) !== 1) return null;
          await tx.exec(
            'UPDATE outbox SET next_attempt_at=?,payload=? WHERE id=? AND workspace_id=? AND next_attempt_at=?',
            [
              stamp(clock() + (rateLimited ? delay * 1000 : 1000)),
              '{}',
              job.gateId,
              job.workspace_id,
              renewed,
            ],
          );
          return { status, failed: (status === 'pending' && !rateLimited) || status === 'failed' };
        },
        { timeoutMs: Math.max(1, deadline - clock()) },
      );
    } catch {
      // A database/lock failure leaves the owned claim recoverable after its lease; no stale write.
      result.failed++;
    }
    if (outcome?.status === 'done') result.processed++;
    if (outcome?.failed) result.failed++;
  }

  return result;
}

export async function dispatchSlackNotifications(
  db,
  env,
  {
    send,
    limit = 20,
    clock = Date.now,
    deadline = clock() + 40000,
    includeFuture = false,
    jobIds,
  } = {},
) {
  if (
    (jobIds && jobIds.length === 0) ||
    isSlackPreview(env) ||
    !env.INTEGRATIONS_WORKSPACE_ID ||
    !env.SLACK_BOT_TOKEN ||
    !env.SLACK_CHANNEL_ID
  )
    return { sent: 0 };
  const state = await db.transaction(
    async (tx) => {
      if (!(await destinationMatches(tx, env))) return { jobs: [], gate: null };
      const rows = await tx.all(
        `SELECT id,attempts,next_attempt_at FROM outbox WHERE workspace_id=? AND provider='slack' AND (${slackJsonField(tx, 'channel')} IS NULL OR ${slackJsonField(tx, 'channel')}=?) AND status IN ('pending','processing') ${includeFuture ? '' : 'AND next_attempt_at<=?'} ${jobIds ? `AND id IN (${jobIds.map(() => '?').join(',')})` : ''} ORDER BY created_at,id LIMIT ?`,
        [
          env.INTEGRATIONS_WORKSPACE_ID,
          env.SLACK_CHANNEL_ID,
          ...(includeFuture ? [] : [stamp(clock())]),
          ...(jobIds ?? []),
          limit,
        ],
      );
      const gate = await tx.one(
        'SELECT next_attempt_at FROM outbox WHERE id=? AND workspace_id=?',
        [
          gateKey(env.INTEGRATIONS_WORKSPACE_ID, env.SLACK_CHANNEL_ID),
          env.INTEGRATIONS_WORKSPACE_ID,
        ],
      );
      return { jobs: rows, gate };
    },
    { readOnly: true, timeoutMs: Math.max(1, deadline - clock()) },
  );
  const jobs = state.jobs;
  if (!jobs.length) return { sent: 0 };
  const publish = send ?? (await import('@vercel/queue')).send;
  for (const job of jobs) {
    const due = Math.max(
      Date.parse(job.next_attempt_at),
      state.gate ? Date.parse(state.gate.next_attempt_at) : 0,
    );
    const delaySeconds = Math.min(604799, Math.max(0, Math.ceil((due - clock()) / 1000)));
    if (clock() >= deadline)
      throw Object.assign(Error('Slack queue publication budget expired'), {
        code: 'SLACK_QUEUE_UNAVAILABLE',
      });
    let timer;
    try {
      await Promise.race([
        publish(
          'tasks-slack-notifications',
          { jobId: job.id },
          {
            region: 'fra1',
            retentionSeconds: Math.max(86400, delaySeconds + 1),
            delaySeconds,
            idempotencyKey: `slack:${job.id}:${job.attempts}:window-${Math.floor(clock() / 120000)}`,
          },
        ),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                Object.assign(Error('Slack queue publication timed out'), {
                  code: 'SLACK_QUEUE_UNAVAILABLE',
                }),
              ),
            Math.max(1, Math.min(10000, deadline - clock())),
          );
        }),
      ]);
    } catch {
      throw Object.assign(Error('Slack queue publication unavailable'), {
        code: 'SLACK_QUEUE_UNAVAILABLE',
      });
    } finally {
      clearTimeout(timer);
    }
  }
  return { sent: jobs.length };
}
export async function processSlackMessage(db, env, message, options = {}) {
  const clock = options.clock ?? Date.now;
  const deadline = options.deadline ?? clock() + 40000;
  options = { ...options, clock, deadline };
  if (isSlackPreview(env)) return { status: 'preview' };
  const existing = await db.transaction(
    (tx) =>
      tx.one(
        "SELECT status,payload FROM outbox WHERE provider='slack' AND workspace_id=? AND id=?",
        [env.INTEGRATIONS_WORKSPACE_ID, message.jobId],
      ),
    { readOnly: true, timeoutMs: Math.max(1, deadline - clock()) },
  );
  if (!existing) return { status: 'missing' };
  const destination = JSON.parse(existing.payload).channel;
  if (
    (destination && destination !== env.SLACK_CHANNEL_ID) ||
    !(await db.transaction((tx) => destinationMatches(tx, env), {
      readOnly: true,
      timeoutMs: Math.max(1, deadline - clock()),
    }))
  )
    return { status: 'inactive-destination' };
  if (!terminal.includes(existing.status))
    await runSlackDelivery(db, env, { ...options, limit: 1, jobId: message.jobId });
  const row = await db.transaction(
    (tx) =>
      tx.one(
        "SELECT status,next_attempt_at FROM outbox WHERE provider='slack' AND workspace_id=? AND id=?",
        [env.INTEGRATIONS_WORKSPACE_ID, message.jobId],
      ),
    { readOnly: true, timeoutMs: Math.max(1, deadline - clock()) },
  );
  if (!row || terminal.includes(row.status)) {
    await dispatchSlackNotifications(db, env, { ...options, limit: 1, includeFuture: true });
    return { status: row?.status ?? 'missing' };
  }
  const gate = await db.transaction(
    (tx) =>
      tx.one('SELECT next_attempt_at FROM outbox WHERE id=? AND workspace_id=?', [
        gateKey(env.INTEGRATIONS_WORKSPACE_ID, env.SLACK_CHANNEL_ID),
        env.INTEGRATIONS_WORKSPACE_ID,
      ]),
    { readOnly: true, timeoutMs: Math.max(1, deadline - clock()) },
  );
  throw Object.assign(Error('Slack retry scheduled'), {
    code: 'SLACK_RETRY',
    retryAfterSeconds: Math.max(
      1,
      Math.ceil(
        (Math.max(Date.parse(row.next_attempt_at), gate ? Date.parse(gate.next_attempt_at) : 0) -
          (options.clock ?? Date.now)()) /
          1000,
      ),
    ),
  });
}
export async function recoverSlackNotifications(db, env, options = {}) {
  const clock = options.clock ?? Date.now;
  options = { ...options, clock, deadline: options.deadline ?? clock() + 40000 };
  const result = await runSlackDelivery(db, env, { ...options, limit: 20, waitForPacing: true });
  const continuation = await dispatchSlackNotifications(db, env, {
    ...options,
    limit: 1,
    includeFuture: true,
  });
  return { ...result, continuation };
}
export function withSlackWake(app, { db, env, defer, logger = console, ...options }) {
  return {
    fetch(request) {
      const clock = options.clock ?? Date.now;
      const deadline = options.deadline ?? clock() + 55000;
      return withSlackRequest(async (scope, nested) => {
        const response = await app.fetch(request);
        if (!nested && !isSlackPreview(env) && scope.jobs.size) {
          const work = dispatchSlackNotifications(db, env, {
            ...options,
            clock,
            deadline,
            jobIds: [...scope.jobs],
          }).catch(() => {
            logger.error({ code: 'SLACK_QUEUE_UNAVAILABLE' });
          });
          if (defer) defer(work);
          else await work;
        }
        return response;
      });
    },
  };
}
