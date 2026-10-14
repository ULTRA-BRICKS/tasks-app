import { noteSlackJob } from './slack-wake.mjs';
/** Event-time Slack snapshots, reached from recordActivity inside its mutation transaction.
 * Activation is explicit; imported actors and historical outbox rows cannot publish native events.
 */
import { id } from '../../core/crypto.mjs';
import { activationKey, isSlackPreview, slackJsonField } from './slack-state.mjs';
import { isBotProfile } from '../../../../src/shared/lib/canonical-people.mjs';

const fieldLabels = {
  title: 'Title',
  description: 'Description',
  kind: 'Type',
  priority: 'Priority',
  assignee_id: 'Assignee',
  assignee_source_id: 'Assignee',
  project_id: 'Project',
  cycle_id: 'Cycle',
  milestone_id: 'Milestone',
  parent_id: 'Parent',
  estimate: 'Estimate',
  start_date: 'Start date',
  due_date: 'Due date',
  label_ids: 'Labels',
};

async function mappedActorName(tx, actor, config) {
  const users = Object.entries(config.user_map ?? {})
    .filter(([, member]) => member === actor.id)
    .map(([user]) => user);
  if (
    users.length !== 1 ||
    Object.hasOwn(config.source_person_map ?? {}, users[0]) ||
    isBotProfile(actor)
  )
    return actor.name;
  const suffix = users[0].replace(/[!%_]/g, (character) => '!' + character);
  const profiles = await tx.all(
    "SELECT id,name,email,source_id FROM source_people WHERE workspace_id=? AND provider='slack' AND source_id LIKE ? ESCAPE '!' LIMIT 2",
    [actor.workspace_id, `%:${suffix}`],
  );
  if (profiles.length !== 1 || isBotProfile(profiles[0])) return actor.name;
  const profile = profiles[0];
  const flags =
    tx.dialect === 'postgres'
      ? await tx.one(
          "SELECT config::jsonb->'profiles'->?->>'bot' AS bot FROM module_settings WHERE workspace_id=? AND module='slack-profiles'",
          [profile.source_id, actor.workspace_id],
        )
      : await tx.one(
          "SELECT json_extract(config,?) AS bot FROM module_settings WHERE workspace_id=? AND module='slack-profiles'",
          [`$.profiles.${JSON.stringify(profile.source_id)}.bot`, actor.workspace_id],
        );
  return [true, 1, 'true'].includes(flags?.bot) ? actor.name : profile.name?.trim() || actor.name;
}

export async function syncSlackActivation(tx, workspace, input, env) {
  const key = activationKey(workspace);
  if (!input.notify) return tx.exec('DELETE FROM outbox WHERE id=?', [key]);
  if (workspace !== env.INTEGRATIONS_WORKSPACE_ID || !env.SLACK_CHANNEL_ID) return;
  const row = await tx.one('SELECT payload FROM outbox WHERE id=?', [key]);
  if (row && JSON.parse(row.payload).channel === env.SLACK_CHANNEL_ID) return;
  const time = new Date().toISOString();
  await tx.exec(
    "INSERT INTO outbox(id,workspace_id,provider,event,payload,status,attempts,next_attempt_at,created_at) VALUES(?,?,'slack','activation',?,'state',0,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
    [
      key,
      workspace,
      JSON.stringify({ activated_at: time, channel: env.SLACK_CHANNEL_ID, generation: id() }),
      time,
      time,
    ],
  );
}

export async function captureSlackNotification(tx, actor, issue, action, changes, time) {
  if (actor.integration || actor.syncOrigin === 'linear') return;
  const setting = await tx.one(
    "SELECT enabled,config FROM module_settings WHERE workspace_id=? AND module='slack'",
    [actor.workspace_id],
  );
  const activation = await tx.one('SELECT payload FROM outbox WHERE id=?', [
    activationKey(actor.workspace_id),
  ]);
  const config = JSON.parse(setting?.config ?? '{}');
  if (!setting?.enabled || !config.notify || !activation) return;
  const meaningful = [
    'title',
    'description',
    'kind',
    'priority',
    'assignee_id',
    'assignee_source_id',
    'project_id',
    'cycle_id',
    'milestone_id',
    'parent_id',
    'estimate',
    'start_date',
    'due_date',
    'label_ids',
  ];
  const fields = Object.keys(changes).filter(
    (key) =>
      meaningful.includes(key) &&
      (key !== 'label_ids' ||
        JSON.stringify([...changes[key].from].sort((a, b) => a.localeCompare(b))) !==
          JSON.stringify([...changes[key].to].sort((a, b) => a.localeCompare(b)))),
  );
  const event =
    action === 'created'
      ? 'created'
      : action === 'commented'
        ? 'commented'
        : action === 'updated' &&
            changes.status_id &&
            changes.status_id.from !== changes.status_id.to
          ? 'status'
          : action === 'updated' && fields.length
            ? 'updated'
            : null;
  if (!event) return;
  const team = await tx.one('SELECT id,name,key FROM teams WHERE workspace_id=? AND id=?', [
    actor.workspace_id,
    issue.team_id,
  ]);
  const status = await tx.one('SELECT name,category FROM statuses WHERE workspace_id=? AND id=?', [
    actor.workspace_id,
    issue.status_id,
  ]);
  const project = issue.project_id
    ? await tx.one('SELECT name FROM projects WHERE workspace_id=? AND id=?', [
        actor.workspace_id,
        issue.project_id,
      ])
    : null;
  const labels = await tx.all(
    'SELECT l.name FROM labels l JOIN issue_labels il ON il.label_id=l.id WHERE l.workspace_id=? AND il.issue_id=? ORDER BY l.name',
    [actor.workspace_id, issue.id],
  );
  const comment =
    event === 'commented'
      ? await tx.one('SELECT body FROM comments WHERE workspace_id=? AND id=?', [
          actor.workspace_id,
          changes.comment_id,
        ])
      : null;
  const snapshot = {
    format: 'tasks-slack-v1',
    issue_id: issue.id,
    key: issue.key,
    title: issue.title,
    kind: issue.kind,
    actor: await mappedActorName(tx, actor, config),
    team,
    status,
    project: project?.name,
    priority: ['None', 'Urgent', 'High', 'Medium', 'Low'][issue.priority],
    labels: labels.map((label) => label.name),
    body: event === 'created' ? issue.description : comment?.body,
    fields: [...new Set(fields.map((field) => fieldLabels[field]))],
    occurred_at: time,
    channel: JSON.parse(activation.payload).channel,
    activation_generation: JSON.parse(activation.payload).generation,
  };
  const jobId = id();
  await tx.exec(
    "INSERT INTO outbox(id,workspace_id,provider,event,payload,status,attempts,next_attempt_at,created_at) VALUES(?,?,'slack',?,?,'pending',0,?,?)",
    [jobId, actor.workspace_id, event, JSON.stringify(snapshot), time, time],
  );
  noteSlackJob(tx, jobId);
}

function escape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
export function slackMarkdown(value) {
  return String(value ?? '')
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]+`)/g)
    .map((part) => {
      if (part.startsWith('`')) return escape(part);
      return escape(part)
        .replace(/^#{1,6}\s+(.+)$/gm, '\u200b*$1*\u200b')
        .replace(/^\s*[-*+]\s+/gm, '• ')
        .replace(/\*\*(.+?)\*\*/g, '*$1*')
        .replace(/!?\[([^\]]*)\]\(([^)]+)\)/g, '$1 ($2)');
    })
    .join('');
}
function bounded(value, limit) {
  if (value.length <= limit) return value;
  let result = value.slice(0, limit - 1);
  if (/[\uD800-\uDBFF]$/.test(result)) result = result.slice(0, -1);
  result = result.replace(/&[^;]*$/, '');
  result = result.replace(/\(https?:\/\/[^\s)]*$/, '').replace(/https?:\/\/\S*$/, '');
  return result + '…';
}
function controlledLink(url, label, limit = 3000) {
  const safeLabel = bounded(
    escape(label).replaceAll('|', '｜'),
    Math.max(1, limit - url.length - 3),
  );
  return `<${url}|${safeLabel}>`;
}
export function renderSlackNotification(job, env) {
  const data = JSON.parse(job.payload),
    link = `${env.APP_URL}/tasks/${encodeURIComponent(data.issue_id)}`;
  if (job.event === 'confirmation')
    return {
      text: `${bounded(`${escape(data.key)}: ${escape(data.title)}`, Math.max(1, 3999 - link.length))}\n${link}`,
    };
  // Plain notification previews omit rich card navigation and marker syntax.
  const header =
    job.event === 'created'
      ? `${data.actor} created an issue in ${data.team?.name ?? 'the team'}`
      : job.event === 'status'
        ? `${data.actor} changed issue status to ${data.status?.name ?? 'Unknown'}`
        : job.event === 'commented'
          ? `${data.actor} commented on ${data.key}`
          : `${data.actor} updated ${data.key}`;
  const actorLabel = `*${bounded(escape(data.actor).replaceAll('*', '∗'), 300)}*`;
  const taskLink = controlledLink(link, data.key + ' ' + data.title, 2000);
  const teamLink = data.team?.id
    ? controlledLink(
        `${env.APP_URL}/tasks?team_id=${encodeURIComponent(data.team.id)}`,
        data.team.name,
        1200,
      )
    : bounded(escape(data.team?.name ?? 'the team'), 300);
  const statusLabel = `*${bounded(escape(data.status?.name ?? 'Unknown').replaceAll('*', '∗'), 300)}*`;
  const cardHeader =
    job.event === 'created'
      ? `${actorLabel} created an issue in the ${teamLink} team`
      : job.event === 'status'
        ? `${data.status?.category === 'completed' ? ':white_check_mark:  ' : ''}${actorLabel} changed issue status to ${statusLabel} in ${teamLink} team`
        : job.event === 'commented'
          ? `${actorLabel} commented on ${taskLink}`
          : `${actorLabel} updated ${taskLink}`;
  const mrkdwn = (text, limit = 3000) => ({
    type: 'mrkdwn',
    text: bounded(text, limit),
    verbatim: true,
  });
  const blocks = [
    { type: 'section', text: mrkdwn(cardHeader) },
    { type: 'section', text: mrkdwn(controlledLink(link, data.key + ' ' + data.title)) },
  ];
  if (data.body) blocks.push({ type: 'section', text: mrkdwn(slackMarkdown(data.body)) });
  const values = [
    ['State', data.status?.name],
    ['Priority', data.priority === 'None' ? null : data.priority],
    ['Project', data.project],
    [
      'Labels',
      data.labels?.length
        ? data.labels.slice(0, 4).join(', ') +
          (data.labels.length > 4 ? ` and ${data.labels.length - 4} more` : '')
        : null,
    ],
    ['Updated', job.event === 'updated' ? data.fields.join(', ') : null],
  ].filter(([, value]) => value);
  if (values.length)
    blocks.push({
      type: 'section',
      fields: values.map(([label, value]) => mrkdwn(`*${label}*\n${escape(value)}`, 2000)),
    });
  blocks.push({
    type: 'context',
    elements: [
      mrkdwn(
        `<!date^${Math.floor(Date.parse(data.occurred_at) / 1000)}^{date_short_pretty} at {time}|${data.occurred_at}> · <${link}|${job.event === 'commented' ? 'Reply in Tasks' : 'Open in Tasks'}>`,
      ),
    ],
  });
  return {
    text: bounded(`${escape(header)}\n${escape(data.key)}: ${escape(data.title)}\n${link}`, 4000),
    blocks,
  };
}

export async function slackActivationStatus(tx, workspace, env) {
  const row = await tx.one('SELECT payload FROM outbox WHERE id=?', [activationKey(workspace)]);
  const data = row ? JSON.parse(row.payload) : null;
  const settings = await tx.one(
    "SELECT enabled,config FROM module_settings WHERE workspace_id=? AND module='slack'",
    [workspace],
  );
  const channelMatches = Boolean(data && data.channel === env.SLACK_CHANNEL_ID);
  const ready = Boolean(
    data &&
    settings?.enabled &&
    JSON.parse(settings.config).notify &&
    workspace === env.INTEGRATIONS_WORKSPACE_ID &&
    channelMatches &&
    env.SLACK_BOT_TOKEN &&
    !isSlackPreview(env),
  );
  const channelField = slackJsonField(tx, 'channel');
  const generationField = slackJsonField(tx, 'activation_generation');
  const delivered =
    data && channelMatches
      ? await tx.all(
          `SELECT payload FROM outbox WHERE workspace_id=? AND provider='slack' AND event IN ('created','status','updated','commented') AND status='done' AND created_at>=? AND ${channelField}=? AND ${generationField}=? ORDER BY created_at DESC LIMIT 1`,
          [workspace, data.activated_at, data.channel, data.generation],
        )
      : [];
  const deliveryVerified = delivered.some((job) => {
    const payload = JSON.parse(job.payload);
    return (
      payload.format === 'tasks-slack-v1' &&
      payload.channel === data.channel &&
      payload.activation_generation === data.generation &&
      payload.receipt?.channel === data.channel &&
      /^[0-9]+\.[0-9]+$/.test(payload.receipt.ts ?? '')
    );
  });
  return {
    armed: Boolean(data),
    ready,
    delivery_verified: deliveryVerified,
    active: ready && deliveryVerified,
    activated_at: data?.activated_at ?? null,
    channel_matches: channelMatches,
  };
}
