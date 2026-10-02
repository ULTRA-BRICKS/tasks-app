import { hmac } from '../../packages/server/core/crypto.mjs';
import { collections } from '../../packages/imports/linear-source.mjs';
import { sourceFixture } from './linear-import-fixture.mjs';

export async function stageAndComplete(f, source) {
  const created = await f.request('POST', '/api/v1/imports/linear', { manifest: source.manifest });
  if (created.status !== 201) throw new Error('stage create failed: ' + JSON.stringify(created));
  const run = created.data.id;
  for (const collection of collections)
    if (source.data[collection].length) {
      const result = await f.request('POST', `/api/v1/imports/linear/${run}/records`, {
        collection,
        records: source.data[collection],
      });
      if (result.status !== 200) throw new Error('stage records failed: ' + JSON.stringify(result));
    }
  const plan = await f.request('POST', `/api/v1/imports/linear/${run}/plan`);
  if (plan.status !== 200) throw new Error('plan failed: ' + JSON.stringify(plan));
  const applied = await f.request('POST', `/api/v1/imports/linear/${run}/apply`, {
    plan_hash: plan.data.plan_hash,
  });
  if (applied.status !== 200) throw new Error('apply failed: ' + JSON.stringify(applied));
  return run;
}

/** A fixture with a completed Linear import and Linear sync configured for that workspace. */
export async function syncFixture(fixtureFn, extra = {}) {
  const f = await fixtureFn({
    LINEAR_WEBHOOK_SECRET: 'linear-webhook-secret',
    LINEAR_API_TOKEN: 'test-linear-token',
    ...extra,
  });
  const source = sourceFixture();
  await stageAndComplete(f, source);
  f.env.LINEAR_SYNC_WORKSPACE_ID = f.init.workspace_id;
  return { f, source };
}

export function linearWebhookPayload({
  type,
  action,
  dataId,
  organizationId,
  actorId,
  webhookTimestamp,
}) {
  return {
    action,
    type,
    createdAt: new Date().toISOString(),
    data: { id: dataId },
    organizationId,
    webhookTimestamp: webhookTimestamp ?? Date.now(),
    webhookId: crypto.randomUUID(),
    ...(actorId ? { actor: { id: actorId } } : {}),
  };
}
export function signedWebhookRequest(payload, secret, { deliveryId = crypto.randomUUID() } = {}) {
  const raw = JSON.stringify(payload);
  return {
    raw,
    headers: {
      'content-type': 'application/json',
      'linear-signature': hmac(secret, raw),
      'linear-delivery': deliveryId,
    },
  };
}
export function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
/** A fake Linear GraphQL transport: never touches the network. */
export function fakeLinearTransport({ organizationId, issuesById = {}, commentsById = {} }) {
  return async (url, options) => {
    if (url !== 'https://api.linear.app/graphql') throw new Error('Unexpected endpoint: ' + url);
    const body = JSON.parse(options.body);
    if (body.query.includes('organization {'))
      return jsonResponse({ data: { organization: { id: organizationId } } });
    if (body.query.includes('issue(id'))
      return jsonResponse({ data: { issue: issuesById[body.variables.id] ?? null } });
    if (body.query.includes('comment(id'))
      return jsonResponse({ data: { comment: commentsById[body.variables.id] ?? null } });
    if (body.query.includes('issues('))
      return jsonResponse({
        data: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } },
      });
    if (body.query.includes('comments('))
      return jsonResponse({
        data: { comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } },
      });
    throw new Error('Unexpected GraphQL query in test fetcher: ' + body.query);
  };
}
export function fakeIssueRecord(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    identifier: 'SRC-99',
    number: 99,
    title: 'Fresh from Linear',
    description: '',
    priority: 0,
    estimate: null,
    dueDate: null,
    sortOrder: 99,
    trashed: false,
    archivedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    url: 'https://linear.app/example/issue/SRC-99',
    labelIds: [],
    ...overrides,
  };
}
