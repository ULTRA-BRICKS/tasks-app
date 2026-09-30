import { id, now, sha256, hmac, constantEqual } from '../../core/crypto.mjs';
import { assert, requirePermission } from '../../core/errors.mjs';
import { assertModule } from '../../core/modules.mjs';
import { createIssue, updateIssue, getIssue, addComment } from '../tickets/service.mjs';
import { sessionScopes } from '../identity/service.mjs';
import { isBotProfile } from '../../../../src/shared/lib/canonical-people.mjs';

export function verifyGitHub(raw, signature, secret) {
  assert(secret, 503, 'GITHUB_NOT_CONFIGURED', 'GitHub signing secret is not configured');
  assert(
    constantEqual(signature ?? '', 'sha256=' + hmac(secret, raw)),
    401,
    'BAD_SIGNATURE',
    'Invalid webhook signature',
  );
}
export function verifySlack(raw, timestamp, signature, secret, time = Date.now()) {
  assert(secret, 503, 'SLACK_NOT_CONFIGURED', 'Slack signing secret is not configured');
  assert(
    /^\d+$/.test(timestamp ?? '') && Math.abs(time / 1000 - Number(timestamp)) <= 300,
    401,
    'STALE_REQUEST',
    'Slack request is stale',
  );
  assert(
    constantEqual(signature ?? '', 'v0=' + hmac(secret, `v0:${timestamp}:${raw.toString()}`)),
    401,
    'BAD_SIGNATURE',
    'Invalid Slack signature',
  );
}
export async function receiveWebhook(tx, provider, headers, raw, env) {
  const workspace = env.INTEGRATIONS_WORKSPACE_ID;
  assert(workspace, 503, 'INTEGRATIONS_NOT_CONFIGURED', 'Integration workspace is not configured');
  await tx.lock(workspace);
  await assertModule(tx, workspace, provider);
  let payload, event, deliveryId;
  if (provider === 'github') {
    verifyGitHub(raw, headers.get('x-hub-signature-256'), env.GITHUB_WEBHOOK_SECRET);
    try {
      payload = JSON.parse(raw);
    } catch {
      assert(false, 400, 'INVALID_JSON', 'Invalid webhook payload');
    }
    assert(
      payload.repository?.full_name?.toLowerCase() === env.GITHUB_REPOSITORY?.toLowerCase(),
      403,
      'REPOSITORY_NOT_ALLOWED',
      'Repository is not configured for this workspace',
    );
    event = headers.get('x-github-event');
    deliveryId = headers.get('x-github-delivery');
    assert(
      deliveryId && deliveryId.length <= 160,
      400,
      'MISSING_DELIVERY',
      'GitHub delivery ID required',
    );
  } else {
    verifySlack(
      raw,
      headers.get('x-slack-request-timestamp'),
      headers.get('x-slack-signature'),
      env.SLACK_SIGNING_SECRET,
    );
    const form = new URLSearchParams(raw.toString());
    try {
      payload = form.has('payload') ? JSON.parse(form.get('payload')) : Object.fromEntries(form);
    } catch {
      assert(false, 400, 'INVALID_PAYLOAD', 'Invalid Slack payload');
    }
    const teamId = typeof payload.team === 'object' ? payload.team.id : payload.team_id;
    const channelId = typeof payload.channel === 'object' ? payload.channel.id : payload.channel_id;
    assert(
      teamId === env.SLACK_TEAM_ID && channelId === env.SLACK_CHANNEL_ID,
      403,
      'SLACK_CONTEXT_NOT_ALLOWED',
      'Slack workspace or channel is not allowed',
    );
    // Do not persist response_url or trigger_id: they are credentials, and a user-controlled response_url is an SSRF risk.
    delete payload.response_url;
    delete payload.trigger_id;
    event = payload.type === 'message_action' ? 'message_action' : 'slash_command';
    assert(
      event === 'message_action' || payload.command === '/tickets',
      400,
      'UNKNOWN_COMMAND',
      'Expected /tickets command',
    );
    deliveryId = sha256(headers.get('x-slack-request-timestamp') + ':' + raw.toString());
  }
  const result = await tx.exec(
    "INSERT INTO webhook_deliveries(id,workspace_id,provider,delivery_id,payload,event,status,attempts,next_attempt_at,created_at) VALUES(?,?,?,?,?,?,'pending',0,?,?) ON CONFLICT(workspace_id,provider,delivery_id) DO NOTHING",
    [id(), workspace, provider, deliveryId, JSON.stringify(payload), event, now(), now()],
  );
  return { accepted: true, duplicate: Number(result.changes) === 0 };
}
async function config(tx, workspace, module) {
  return JSON.parse(
    (
      await tx.one('SELECT config FROM module_settings WHERE workspace_id=? AND module=?', [
        workspace,
        module,
      ])
    )?.config ?? '{}',
  );
}
async function actorFor(tx, workspace, userId) {
  const user = await tx.one(
    `SELECT u.id,u.name,u.email,m.role,m.workspace_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ${userId ? 'AND m.user_id=?' : "AND m.role='owner'"} ORDER BY u.created_at LIMIT 1`,
    userId ? [workspace, userId] : [workspace],
  );
  assert(user, 422, 'USER_NOT_MAPPED', 'Integration user is not a workspace member');
  return { ...user, scopes: sessionScopes(user.role), integration: true };
}
async function addExternalLink(tx, actor, issue, provider, externalId, url, title) {
  assert(/^https:\/\//.test(url), 422, 'INVALID_URL', 'External link must use HTTPS');
  await tx.exec(
    'INSERT INTO external_links(id,workspace_id,issue_id,provider,external_id,url,title) VALUES(?,?,?,?,?,?,?) ON CONFLICT(workspace_id,provider,external_id,issue_id) DO UPDATE SET title=excluded.title',
    [id(), actor.workspace_id, issue.id, provider, String(externalId), url, title],
  );
}
async function handleGitHub(tx, job) {
  const data = JSON.parse(job.payload),
    actor = await actorFor(tx, job.workspace_id),
    settings = await config(tx, job.workspace_id, 'github');
  if (job.event === 'pull_request') {
    const pr = data.pull_request;
    if (!pr) return;
    const refs = [
      ...new Set(
        `${pr.title ?? ''} ${pr.body ?? ''} ${pr.head?.ref ?? ''}`.match(
          /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g,
        ) ?? [],
      ),
    ];
    for (const key of refs.slice(0, 100)) {
      let issue;
      try {
        issue = await getIssue(tx, actor, key);
      } catch (e) {
        if (e.status === 404) continue;
        throw e;
      }
      await addExternalLink(
        tx,
        actor,
        issue,
        'github',
        `pr:${data.repository.full_name}:${pr.number}`,
        pr.html_url,
        `#${pr.number} ${pr.title}`,
      );
      const nextStatus =
        pr.merged && data.action === 'closed'
          ? settings.done_status_id
          : ['opened', 'reopened', 'ready_for_review'].includes(data.action) && !pr.draft
            ? settings.review_status_id
            : null;
      if (nextStatus) {
        const status = await tx.one(
          'SELECT id FROM statuses WHERE workspace_id=? AND team_id=? AND id=?',
          [actor.workspace_id, issue.team_id, nextStatus],
        );
        if (status && issue.status_id !== nextStatus)
          await updateIssue(tx, actor, issue.id, { version: issue.version, status_id: nextStatus });
      }
    }
  }
  if (job.event === 'issues' && data.issue) {
    const ext = `issue:${data.repository.full_name}:${data.issue.number}`;
    const link = await tx.one(
      'SELECT issue_id FROM external_links WHERE workspace_id=? AND provider=? AND external_id=?',
      [job.workspace_id, 'github', ext],
    );
    if (data.action === 'opened' && !link) {
      // A GitHub echo may arrive before the exporting worker has committed its link.
      // Only a marker backed by OUR workspace's outgoing job may claim an existing issue.
      const marker = String(data.issue.body ?? '').match(
        /<!-- tickets-outbox:([0-9a-f-]{36}) -->/i,
      )?.[1];
      const exported = marker
        ? await tx.one(
            "SELECT payload FROM outbox WHERE id=? AND workspace_id=? AND provider='github' AND event='export'",
            [marker, job.workspace_id],
          )
        : null;
      if (exported) {
        const original = await getIssue(tx, actor, JSON.parse(exported.payload).issue_id);
        await addExternalLink(
          tx,
          actor,
          original,
          'github',
          ext,
          data.issue.html_url,
          `#${data.issue.number} ${data.issue.title}`,
        );
        return;
      }
      const team = await tx.one('SELECT id FROM teams WHERE workspace_id=? ORDER BY key LIMIT 1', [
        job.workspace_id,
      ]);
      const issue = await createIssue(
        tx,
        actor,
        {
          team_id: team.id,
          title: data.issue.title.slice(0, 300),
          description: (data.issue.body ?? '').slice(0, 100000),
        },
        { idempotencyKey: `github:${data.repository.id}:${data.issue.number}` },
      );
      await addExternalLink(
        tx,
        actor,
        issue,
        'github',
        ext,
        data.issue.html_url,
        `#${data.issue.number} ${data.issue.title}`,
      );
    }
    // Existing linked issues receive explicit comments, not silent overwrites of local descriptions/statuses.
    if (link && ['closed', 'reopened'].includes(data.action))
      await addComment(
        tx,
        actor,
        link.issue_id,
        `GitHub issue #${data.issue.number} was ${data.action}. ${data.issue.html_url}`,
      );
  }
}
async function handleSlack(tx, job) {
  const data = JSON.parse(job.payload),
    settings = await config(tx, job.workspace_id, 'slack');
  const slackId = data.user?.id ?? data.user_id;
  assert(
    settings.user_map?.[slackId],
    403,
    'USER_NOT_MAPPED',
    'Slack user must be explicitly mapped by an administrator',
  );
  const actor = await actorFor(tx, job.workspace_id, settings.user_map[slackId]);
  requirePermission(actor, 'write');
  const text = String(data.message?.text ?? data.text ?? '').trim();
  assert(text.length > 0, 422, 'EMPTY_COMMAND', 'Specify an issue title');
  const issue = await createIssue(
    tx,
    actor,
    {
      team_id: settings.team_id,
      title: text.split('\n')[0].slice(0, 300),
      description: job.event === 'message_action' ? text.slice(0, 100000) : '',
    },
    { idempotencyKey: `slack:${job.delivery_id}` },
  );
  const channel = data.channel?.id ?? data.channel_id,
    ts = data.message?.ts;
  if (ts)
    await addExternalLink(
      tx,
      actor,
      issue,
      'slack',
      `${channel}:${ts}`,
      `https://app.slack.com/archives/${encodeURIComponent(channel)}/p${ts.replace('.', '')}`,
      'Slack source message',
    );
  await tx.exec(
    "INSERT INTO outbox(id,workspace_id,provider,event,payload,status,attempts,next_attempt_at,created_at) VALUES(?,?,?,'created',?,'pending',0,?,?)",
    [
      id(),
      job.workspace_id,
      'slack',
      JSON.stringify({ issue_id: issue.id, key: issue.key, title: issue.title, actor: actor.name }),
      now(),
      now(),
    ],
  );
}
export async function setIntegrationConfig(tx, actor, provider, input) {
  requirePermission(actor, 'admin');
  await assertModule(tx, actor.workspace_id, provider);
  if (provider === 'slack') {
    assert(
      await tx.one('SELECT id FROM teams WHERE workspace_id=? AND id=?', [
        actor.workspace_id,
        input.team_id,
      ]),
      422,
      'INVALID_TEAM',
      'Team not found',
    );
    const userMap = input.user_map ?? {},
      sourceMap = input.source_person_map ?? {};
    for (const user of Object.values(userMap))
      assert(
        await tx.one('SELECT user_id FROM memberships WHERE workspace_id=? AND user_id=?', [
          actor.workspace_id,
          user,
        ]),
        422,
        'INVALID_MEMBER',
        'Mapped user must be a member',
      );
    // An imported person is a Linear (or other non-Slack) author of this workspace; the lookup is
    // workspace-scoped, so another workspace's person reads as missing. Never matched by name.
    // Stored bot flags cover Slack profiles only, so a non-Slack target is judged by its own data.
    const targets = new Set();
    for (const [slackUserId, personId] of Object.entries(sourceMap)) {
      assert(
        !Object.hasOwn(userMap, slackUserId),
        422,
        'AMBIGUOUS_MAPPING',
        'A Slack user maps to a member or to an imported person, not to both',
      );
      assert(
        !targets.has(personId),
        422,
        'AMBIGUOUS_MAPPING',
        'Two Slack users cannot map to the same imported person',
      );
      targets.add(personId);
      const person = await tx.one(
        'SELECT id,name,provider,source_id,email FROM source_people WHERE workspace_id=? AND id=?',
        [actor.workspace_id, personId],
      );
      assert(
        person && person.provider !== 'slack',
        422,
        'INVALID_SOURCE_PERSON',
        'Mapped person must be an imported person of this workspace from a source other than Slack',
      );
      assert(!isBotProfile(person), 422, 'BOT_MAPPING', 'A bot cannot be mapped to a Slack user');
    }
  } else
    for (const field of ['review_status_id', 'done_status_id'])
      if (input[field])
        assert(
          await tx.one('SELECT id FROM statuses WHERE workspace_id=? AND id=?', [
            actor.workspace_id,
            input[field],
          ]),
          422,
          'INVALID_STATUS',
          'Mapped status not found',
        );
  await tx.exec(
    'INSERT INTO module_settings(workspace_id,module,enabled,config) VALUES(?,?,1,?) ON CONFLICT(workspace_id,module) DO UPDATE SET config=excluded.config',
    [actor.workspace_id, provider, JSON.stringify(input)],
  );
  return { provider, config: input };
}
async function processIncoming(db, job) {
  await db.transaction(async (tx) => {
    await tx.lock(job.workspace_id);
    await assertModule(tx, job.workspace_id, job.provider);
    const live = await tx.one('SELECT status FROM webhook_deliveries WHERE id=?', [job.id]);
    if (live?.status !== 'processing') return;
    if (job.provider === 'github') await handleGitHub(tx, job);
    else await handleSlack(tx, job);
    await tx.exec("UPDATE webhook_deliveries SET status='done',last_error=NULL WHERE id=?", [
      job.id,
    ]);
  });
}
async function sendOutgoing(job, env, fetcher) {
  assert(
    job.workspace_id === env.INTEGRATIONS_WORKSPACE_ID,
    403,
    'WORKSPACE_NOT_CONFIGURED',
    'Refusing to deliver data from an unconfigured workspace',
  );
  const data = JSON.parse(job.payload);
  if (job.provider === 'slack') {
    assert(
      env.SLACK_BOT_TOKEN && env.SLACK_CHANNEL_ID,
      503,
      'SLACK_NOT_CONFIGURED',
      'Slack bot token and channel are required',
    );
    const response = await fetcher('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: {
        authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        channel: env.SLACK_CHANNEL_ID,
        client_msg_id: job.id,
        text: `${data.key}: ${data.title}\n${env.APP_URL}/issues/${data.issue_id}`,
        unfurl_links: false,
        unfurl_media: false,
      }),
    });
    const body = await response.json();
    assert(response.ok && body.ok, 502, 'SLACK_DELIVERY_FAILED', 'Slack refused the message');
  } else if (job.event === 'export') {
    assert(
      env.GITHUB_TOKEN && /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? ''),
      503,
      'GITHUB_NOT_CONFIGURED',
      'GitHub token and repository required',
    );
    const endpoint = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/issues`;
    const headers = {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'content-type': 'application/json',
    };
    // Outgoing calls are at-least-once. Marker is stable for manual reconciliation after an ambiguous timeout.
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        title: `[${data.key}] ${data.title}`,
        body: `${data.description ?? ''}\n\n<!-- tickets-outbox:${job.id} -->\n${env.APP_URL}/issues/${data.issue_id}`,
      }),
    });
    assert(response.ok, 502, 'GITHUB_DELIVERY_FAILED', 'GitHub refused the issue export');
    return await response.json();
  }
}
export async function runWorker(db, env, { limit = 20, fetcher = fetch } = {}) {
  const results = { processed: 0, failed: 0 };
  for (const table of ['webhook_deliveries', 'outbox']) {
    for (let n = 0; n < limit; n++) {
      const job = await db.transaction(async (tx) => {
        await tx.lock('tickets-app:worker:' + table);
        const row = await tx.one(
          `SELECT * FROM ${table} WHERE provider IN ('github','slack') AND (status='pending' OR status='processing') AND next_attempt_at<=? AND attempts<5 ORDER BY created_at,id LIMIT 1`,
          [now()],
        );
        if (!row) return null;
        await tx.exec(
          `UPDATE ${table} SET status='processing',attempts=attempts+1,next_attempt_at=? WHERE id=?`,
          [new Date(Date.now() + 60000).toISOString(), row.id],
        );
        return { ...row, attempts: row.attempts + 1 };
      });
      if (!job) break;
      try {
        if (table === 'webhook_deliveries') await processIncoming(db, job);
        else {
          await db.transaction(async (tx) => {
            await assertModule(tx, job.workspace_id, job.provider);
          });
          const external = await sendOutgoing(job, env, fetcher);
          await db.transaction(async (tx) => {
            await tx.lock(job.workspace_id);
            if (external?.html_url) {
              const actor = await actorFor(tx, job.workspace_id);
              const issue = await getIssue(tx, actor, JSON.parse(job.payload).issue_id);
              await addExternalLink(
                tx,
                actor,
                issue,
                'github',
                `issue:${env.GITHUB_REPOSITORY}:${external.number}`,
                external.html_url,
                `#${external.number} ${external.title}`,
              );
            }
            await tx.exec("UPDATE outbox SET status='done',last_error=NULL WHERE id=?", [job.id]);
          });
        }
        results.processed++;
      } catch (error) {
        // Log only machine error codes; provider responses can contain credentials or private text.
        await db.transaction((tx) =>
          tx.exec(`UPDATE ${table} SET status=?,next_attempt_at=?,last_error=? WHERE id=?`, [
            job.attempts >= 5 ? 'failed' : 'pending',
            new Date(Date.now() + Math.min(3600, 2 ** job.attempts * 15) * 1000).toISOString(),
            error.code ?? 'DELIVERY_FAILED',
            job.id,
          ]),
        );
        results.failed++;
      }
    }
  }
  return results;
}
