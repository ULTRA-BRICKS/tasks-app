/** Fixed Slack outbox keys and JSON expressions shared by capture, status and delivery.
 * Expressions contain only owned field names; request values remain SQL parameters.
 */
const jsonFields = {
  channel: {
    postgres: "(payload::jsonb->>'channel')",
    sqlite: "json_extract(payload,'$.channel')",
  },
  activation_generation: {
    postgres: "(payload::jsonb->>'activation_generation')",
    sqlite: "json_extract(payload,'$.activation_generation')",
  },
};
export function slackJsonField(tx, field) {
  const expression = jsonFields[field];
  if (!expression) throw Error('Unsupported Slack JSON field');
  return expression[tx.dialect];
}
export const activationKey = (workspace) => `slack-activation:${workspace}`;
export const gateKey = (workspace, channel) => `slack-gate:${workspace}:${channel}`;
export const deliveryLock = (workspace) => `tickets-app:slack-delivery:${workspace}`;
export const isSlackPreview = (env) => Boolean(env.VERCEL_ENV && env.VERCEL_ENV !== 'production');
