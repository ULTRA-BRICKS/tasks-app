import { id, now } from '../../core/crypto.mjs';
const labels = {
  created: 'created an issue',
  updated: 'updated an issue',
  commented: 'commented on an issue',
  archived: 'archived an issue',
  restored: 'restored an issue',
  deleted: 'deleted an issue',
};
const escape = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
export async function enqueueSlackActivity(tx, actor, issue, action, data, config) {
  if (!config.notify || !config.channel_id || !config.connection?.team_id || actor.integration)
    return;
  const event = action === 'updated' && data.archived_at?.to ? 'archived' : action;
  if (!(config.events ?? Object.keys(labels)).includes(event) || !labels[event]) return;
  const status = await tx.one('SELECT name,color FROM statuses WHERE workspace_id=? AND id=?', [
    actor.workspace_id,
    issue.status_id,
  ]);
  const team = await tx.one('SELECT name FROM teams WHERE workspace_id=? AND id=?', [
    actor.workspace_id,
    issue.team_id,
  ]);
  const comment =
    event === 'commented' && data.comment_id
      ? await tx.one('SELECT body FROM comments WHERE workspace_id=? AND id=?', [
          actor.workspace_id,
          data.comment_id,
        ])
      : null;
  const payload = {
    slack_stream: true,
    slack_team_id: config.connection.team_id,
    channel_id: config.channel_id,
    stream_revision: config.stream_revision ?? 0,
    issue_id: issue.id,
    key: issue.key,
    title: issue.title,
    version: issue.version,
    description: event === 'created' ? (issue.description ?? '').slice(0, 2000) : '',
    comment: comment?.body.slice(0, 2000),
    status: status?.name ?? '',
    status_color: status?.color ?? '',
    priority: issue.priority,
    team: team?.name ?? '',
    actor: actor.name,
    changed_fields: Object.keys(data).filter(
      (k) => !['comment_id', 'version', 'position'].includes(k),
    ),
    created_at: now(),
  };
  await tx.exec(
    "INSERT INTO outbox(id,workspace_id,provider,event,payload,status,attempts,next_attempt_at,created_at) VALUES(?,?,'slack',?,?,'pending',0,?,?)",
    [id(), actor.workspace_id, event, JSON.stringify(payload), now(), now()],
  );
}
export function slackMessage(job, origin, { threadTs } = {}) {
  const d = JSON.parse(job.payload),
    url = new URL('/issues/' + encodeURIComponent(d.issue_id), origin).href;
  const title = `${d.key ?? ''} ${d.title ?? ''}`.trim().slice(0, 500),
    actor = String(d.actor ?? 'Tasks').slice(0, 120);
  const text = `${actor} ${labels[job.event] ?? 'updated an issue'}: ${title}`;
  const blocks = [
    { type: 'section', text: { type: 'plain_text', text: text.slice(0, 2900), emoji: true } },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `<${url}|${escape(title).replaceAll('|', '¦')}>` },
    },
  ];
  const body = d.comment || d.description;
  if (body)
    blocks.push({
      type: 'section',
      text: { type: 'plain_text', text: String(body).slice(0, 2000), emoji: true },
    });
  const fields = [
    d.status && `Status: ${d.status}`,
    Number.isInteger(d.priority) &&
      `Priority: ${['None', 'Urgent', 'High', 'Medium', 'Low'][d.priority] ?? d.priority}`,
    d.team && `Team: ${d.team}`,
  ].filter(Boolean);
  if (fields.length)
    blocks.push({
      type: 'context',
      elements: fields.map((value) => ({
        type: 'plain_text',
        text: String(value).slice(0, 300),
        emoji: true,
      })),
    });
  if (d.changed_fields?.length)
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'plain_text',
          text:
            'Changed: ' +
            d.changed_fields
              .map((field) => String(field).replaceAll('_id', '').replaceAll('_', ' '))
              .join(', ')
              .slice(0, 500),
          emoji: true,
        },
      ],
    });
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        action_id: 'tasks_open',
        text: { type: 'plain_text', text: 'Open in Tasks' },
        url,
      },
      {
        type: 'button',
        action_id: 'tasks_comment',
        text: { type: 'plain_text', text: 'Comment in Tasks' },
        url: url + '#comments',
      },
    ],
  });
  return {
    channel: d.channel_id,
    client_msg_id: job.id,
    text: escape(text) + '\n' + url,
    blocks,
    parse: 'none',
    unfurl_links: false,
    unfurl_media: false,
    ...(threadTs ? { thread_ts: threadTs, reply_broadcast: false } : {}),
  };
}
