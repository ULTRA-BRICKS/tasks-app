// Resumable "changed issues/comments since checkpoint" catch-up backstop. Enqueues each
// changed entity as a SYNTHETIC linear_webhook_inbox row so it flows through the exact same
// worker.mjs apply path as a real webhook delivery — this module never touches issue/comment
// rows directly. The cursor is only persisted after its page's transaction commits, so two
// separate invocations resume correctly instead of restarting from the import's completion.
import { id, now } from '../../core/crypto.mjs';
import { assert } from '../../core/errors.mjs';
import { assertModule } from '../../core/modules.mjs';
import { digest } from '../../../imports/linear-source.mjs';
import { linearGraphQL, classifyLinearError } from './client.mjs';

const PAGE_SIZE = 50;
const NODE_FIELDS = 'id updatedAt';
const ISSUES_QUERY = `query($after:String,$updatedAfter:DateTimeOrDuration){ issues(first:${PAGE_SIZE},after:$after,orderBy:updatedAt,filter:{updatedAt:{gt:$updatedAfter}}){ pageInfo{hasNextPage endCursor} nodes{ ${NODE_FIELDS} } } }`;
const COMMENTS_QUERY = `query($after:String,$updatedAfter:DateTimeOrDuration){ comments(first:${PAGE_SIZE},after:$after,orderBy:updatedAt,filter:{updatedAt:{gt:$updatedAfter}}){ pageInfo{hasNextPage endCursor} nodes{ ${NODE_FIELDS} } } }`;

async function syncScope(db, env) {
  const workspace = env.LINEAR_SYNC_WORKSPACE_ID;
  assert(workspace, 503, 'LINEAR_SYNC_NOT_CONFIGURED', 'Linear sync workspace is not configured');
  assert(
    env.LINEAR_API_TOKEN,
    503,
    'LINEAR_SYNC_NOT_CONFIGURED',
    'Linear API token is not configured',
  );
  return db.transaction(async (tx) => {
    await assertModule(tx, workspace, 'linear-sync');
    const run = await tx.one(
      "SELECT id,source_workspace_id,completed_at FROM linear_imports WHERE workspace_id=? AND status='completed' ORDER BY completed_at DESC LIMIT 1",
      [workspace],
    );
    assert(
      run,
      503,
      'LINEAR_SYNC_NOT_CONFIGURED',
      'No completed Linear import exists for this workspace to sync against',
    );
    return {
      workspace,
      sourceWorkspaceId: run.source_workspace_id,
      importCompletedAt: run.completed_at,
    };
  });
}
async function loadCursor(db, workspace, sourceWorkspaceId, collection, fallbackSince) {
  return db.transaction(async (tx) => {
    const row = await tx.one(
      'SELECT cursor,last_synced_at FROM linear_sync_cursors WHERE workspace_id=? AND source_workspace_id=? AND collection=?',
      [workspace, sourceWorkspaceId, collection],
    );
    return { cursor: row?.cursor ?? null, since: row?.last_synced_at ?? fallbackSince };
  });
}
async function persistCursor(
  db,
  workspace,
  sourceWorkspaceId,
  collection,
  cursor,
  lastSyncedAt,
  status,
) {
  await db.transaction((tx) =>
    tx.exec(
      `INSERT INTO linear_sync_cursors(workspace_id,source_workspace_id,collection,cursor,last_synced_at,status) VALUES(?,?,?,?,?,?)
       ON CONFLICT(workspace_id,source_workspace_id,collection) DO UPDATE SET cursor=excluded.cursor,last_synced_at=excluded.last_synced_at,status=excluded.status`,
      [workspace, sourceWorkspaceId, collection, cursor, lastSyncedAt, status],
    ),
  );
}
async function enqueuePage(db, workspace, sourceWorkspaceId, resourceType, collection, nodes) {
  return db.transaction(async (tx) => {
    let enqueued = 0;
    for (const node of nodes) {
      // Deliberately dedups against a real webhook delivery for the same change: same
      // entity + same updatedAt collapses to one inbox row either way.
      const deliveryId = `reconcile:${collection}:${node.id}:${node.updatedAt}`;
      const payload = {
        data: { id: node.id },
        organizationId: sourceWorkspaceId,
        type: resourceType,
        action: 'update',
        webhookTimestamp: Date.now(),
      };
      const insert = await tx.exec(
        "INSERT INTO linear_webhook_inbox(id,workspace_id,organization_id,delivery_id,resource_type,action,payload,payload_hash,webhook_timestamp,status,attempts,next_attempt_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,'pending',0,?,?) ON CONFLICT(workspace_id,delivery_id) DO NOTHING",
        [
          id(),
          workspace,
          sourceWorkspaceId,
          deliveryId,
          resourceType,
          'update',
          JSON.stringify(payload),
          digest(payload),
          String(payload.webhookTimestamp),
          now(),
          now(),
        ],
      );
      if (Number(insert.changes) === 1) enqueued++;
    }
    return enqueued;
  });
}
async function reconcileCollection(
  db,
  env,
  scope,
  collection,
  resourceType,
  query,
  fetcher,
  maxPages,
  deadline,
) {
  const { cursor: startCursor, since } = await loadCursor(
    db,
    scope.workspace,
    scope.sourceWorkspaceId,
    collection,
    scope.importCompletedAt,
  );
  let cursor = startCursor,
    pages = 0,
    enqueued = 0,
    lastSeen = since,
    hasNextPage = true;
  while (hasNextPage && pages < maxPages && Date.now() < deadline) {
    const result = await linearGraphQL(
      env,
      query,
      { after: cursor, updatedAfter: since },
      { fetcher },
    );
    const classification = classifyLinearError(result);
    if (classification.kind !== 'ok')
      return { collection, complete: false, pages, enqueued, error: classification.kind };
    const page = result.body?.data?.[collection];
    if (!page) return { collection, complete: false, pages, enqueued, error: 'EMPTY_RESPONSE' };
    enqueued += await enqueuePage(
      db,
      scope.workspace,
      scope.sourceWorkspaceId,
      resourceType,
      collection,
      page.nodes ?? [],
    );
    for (const node of page.nodes ?? [])
      if (!lastSeen || node.updatedAt > lastSeen) lastSeen = node.updatedAt;
    hasNextPage = Boolean(page.pageInfo?.hasNextPage);
    cursor = page.pageInfo?.endCursor ?? cursor;
    pages++;
    await persistCursor(
      db,
      scope.workspace,
      scope.sourceWorkspaceId,
      collection,
      hasNextPage ? cursor : null,
      lastSeen,
      hasNextPage ? 'in_progress' : 'complete',
    );
  }
  return { collection, complete: !hasNextPage, pages, enqueued };
}

export async function reconcileLinearWorkspace(
  db,
  env,
  { fetcher = fetch, budgetMs = 40000, maxPages = Infinity } = {},
) {
  const scope = await syncScope(db, env);
  const org = await linearGraphQL(env, '{ organization { id } }', {}, { fetcher });
  const orgCheck = classifyLinearError(org, { expectedOrganizationId: scope.sourceWorkspaceId });
  if (orgCheck.kind !== 'ok') return { configured: true, aborted: true, reason: orgCheck.kind };
  const deadline = Date.now() + budgetMs;
  const issues = await reconcileCollection(
    db,
    env,
    scope,
    'issues',
    'Issue',
    ISSUES_QUERY,
    fetcher,
    maxPages,
    deadline,
  );
  const comments = await reconcileCollection(
    db,
    env,
    scope,
    'comments',
    'Comment',
    COMMENTS_QUERY,
    fetcher,
    maxPages,
    deadline,
  );
  return { configured: true, aborted: false, issues, comments };
}
