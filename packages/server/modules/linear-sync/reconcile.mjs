// Resumable "changed issues/comments since checkpoint" catch-up backstop. Enqueues each
// changed entity as a SYNTHETIC linear_webhook_inbox row so it flows through the exact same
// worker.mjs apply path as a real webhook delivery — this module never touches issue/comment
// rows directly.
//
// A catch-up PASS holds a FIXED lower/upper `updatedAt` bound for its ENTIRE duration —
// set once at pass start from the persisted checkpoint, never narrowed page-by-page. The
// `last_synced_at` watermark used as the NEXT pass's lower bound only advances once the
// CURRENT pass's FINAL page commits. Advancing it per-page (the historic bug here) combines
// with a `gt` filter to silently skip same-timestamp rows on the next invocation: page 1's
// last row sets a narrower `since`, and any row on page 2 sharing that exact timestamp gets
// excluded by `gt` on the next call even though it was never actually delivered.
import { id, now } from '../../core/crypto.mjs';
import { assert } from '../../core/errors.mjs';
import { assertModule } from '../../core/modules.mjs';
import { digest } from '../../../imports/linear-source.mjs';
import { linearGraphQL, classifyLinearError } from './client.mjs';

const PAGE_SIZE = 50;
const NODE_FIELDS = 'id updatedAt';
// Inclusive lower bound (gte, not gt): a strict gt combined with a per-pass-fixed since
// would silently exclude a row whose updatedAt lands EXACTLY on the boundary. A duplicate
// re-delivery of an already-applied row this produces is harmless (enqueuePage's
// delivery_id dedup collapses it, and the worker's unchanged-hash check makes a genuine
// re-apply attempt a no-op) — the alternative (permanently losing a boundary row) is not.
const FILTER = 'filter:{updatedAt:{gte:$updatedAfter,lte:$updatedBefore}}';
const ISSUES_QUERY = `query($after:String,$updatedAfter:DateTimeOrDuration,$updatedBefore:DateTimeOrDuration){ issues(first:${PAGE_SIZE},after:$after,orderBy:updatedAt,includeArchived:true,${FILTER}){ pageInfo{hasNextPage endCursor} nodes{ ${NODE_FIELDS} } } }`;
const COMMENTS_QUERY = `query($after:String,$updatedAfter:DateTimeOrDuration,$updatedBefore:DateTimeOrDuration){ comments(first:${PAGE_SIZE},after:$after,orderBy:updatedAt,includeArchived:true,${FILTER}){ pageInfo{hasNextPage endCursor} nodes{ ${NODE_FIELDS} } } }`;
// A sane cap on how deep the pending/processing backlog is allowed to grow before
// reconcile stops enqueueing further pages (finding: unbounded backlog growth with only
// a fixed-size drain per worker invocation and no cron).
const PENDING_WATERMARK = 500;

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
      "SELECT id,source_workspace_id,completed_at,created_at FROM linear_imports WHERE workspace_id=? AND status='completed' ORDER BY completed_at DESC LIMIT 1",
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
      // No field in linear_imports (or the manifest, see packages/imports/linear-source.mjs's
      // validateManifest) records the moment the SOURCE snapshot was actually exported —
      // only when staging started (created_at) and when apply finished (completed_at).
      // Bootstrapping the very first catch-up pass from completed_at leaves a genuine gap:
      // any source edit between snapshot-export and import-commit is invisible forever.
      // Rather than invent an export-cutoff field that doesn't exist, use created_at (when
      // the snapshot was staged, always <= the true export moment) as a deliberately
      // conservative lower bound — it covers the entire staging-to-completion window at
      // the cost of a few redundant (harmless, deduped/no-op) re-deliveries of rows that
      // were already correctly imported.
      firstPassSince: run.created_at,
    };
  });
}

// --- checkpoint: fixed per-pass bounds + optimistic-concurrency guard -----------------

async function ensureCursorRow(db, workspace, sourceWorkspaceId, collection) {
  await db.transaction((tx) =>
    tx.exec(
      `INSERT INTO linear_sync_cursors(workspace_id,source_workspace_id,collection,version) VALUES(?,?,?,0)
       ON CONFLICT(workspace_id,source_workspace_id,collection) DO NOTHING`,
      [workspace, sourceWorkspaceId, collection],
    ),
  );
}
async function loadCheckpoint(db, workspace, sourceWorkspaceId, collection, fallbackSince) {
  await ensureCursorRow(db, workspace, sourceWorkspaceId, collection);
  return db.transaction(async (tx) => {
    const row = await tx.one(
      'SELECT cursor,last_synced_at,pass_since,pass_until,status,version FROM linear_sync_cursors WHERE workspace_id=? AND source_workspace_id=? AND collection=?',
      [workspace, sourceWorkspaceId, collection],
    );
    const resuming = row.status === 'in_progress' && Boolean(row.pass_since);
    return {
      version: row.version,
      cursor: resuming ? row.cursor : null,
      // A fixed bound for the WHOLE pass: resumed from the still-open pass's own bounds,
      // or freshly captured (lower = last completed watermark, upper = now) when starting.
      passSince: resuming ? row.pass_since : (row.last_synced_at ?? fallbackSince),
      passUntil: resuming ? row.pass_until : new Date().toISOString(),
    };
  });
}
// Guarded by an optimistic version check: a concurrent writer racing the same checkpoint
// row loses this update and the caller aborts this pass attempt rather than silently
// clobbering the other writer's progress.
async function persistCheckpoint(
  db,
  workspace,
  sourceWorkspaceId,
  collection,
  patch,
  expectedVersion,
) {
  const advanceWatermark = patch.status === 'complete';
  const params = advanceWatermark
    ? [
        patch.cursor,
        patch.passSince,
        patch.passUntil,
        patch.status,
        patch.passUntil,
        workspace,
        sourceWorkspaceId,
        collection,
        expectedVersion,
      ]
    : [
        patch.cursor,
        patch.passSince,
        patch.passUntil,
        patch.status,
        workspace,
        sourceWorkspaceId,
        collection,
        expectedVersion,
      ];
  const result = await db.transaction((tx) =>
    tx.exec(
      `UPDATE linear_sync_cursors SET cursor=?,pass_since=?,pass_until=?,status=?,version=version+1${advanceWatermark ? ',last_synced_at=?' : ''}
       WHERE workspace_id=? AND source_workspace_id=? AND collection=? AND version=?`,
      params,
    ),
  );
  assert(
    Number(result.changes) === 1,
    409,
    'CHECKPOINT_RACE',
    'Another process updated this reconcile checkpoint concurrently',
  );
  return expectedVersion + 1;
}
async function enqueuePage(db, workspace, sourceWorkspaceId, resourceType, collection, nodes) {
  return db.transaction(async (tx) => {
    let enqueued = 0;
    for (const node of nodes) {
      // Deliberately dedups against a real webhook delivery for the same change: same
      // entity + same updatedAt collapses to one inbox row either way. Genuine cross-path
      // safety (a reconcile row racing a real webhook UUID for the SAME edit) is not this
      // delivery-id scheme's job — it comes from the worker's own claim fencing and the
      // unchanged-remote-hash no-op, which make any inbox-row overlap harmless regardless
      // of delivery_id.
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
function validatePage(page) {
  if (!page || !page.pageInfo) return 'EMPTY_RESPONSE';
  if (page.pageInfo.hasNextPage && !page.pageInfo.endCursor) return 'MALFORMED_CURSOR';
  return null;
}
async function fetchPage(env, query, fetcher, cursor, passSince, passUntil) {
  const result = await linearGraphQL(
    env,
    query,
    { after: cursor, updatedAfter: passSince, updatedBefore: passUntil },
    { fetcher },
  );
  const classification = classifyLinearError(result);
  return { classification, page: result.body?.data };
}
async function pendingCount(db, workspace) {
  const row = await db.transaction((tx) =>
    tx.one(
      "SELECT COUNT(*) AS n FROM linear_webhook_inbox WHERE workspace_id=? AND status IN ('pending','processing')",
      [workspace],
    ),
  );
  return Number(row.n);
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
  const checkpoint = await loadCheckpoint(
    db,
    scope.workspace,
    scope.sourceWorkspaceId,
    collection,
    scope.firstPassSince,
  );
  let cursor = checkpoint.cursor,
    version = checkpoint.version,
    pages = 0,
    enqueued = 0,
    hasNextPage = true;
  const { passSince, passUntil } = checkpoint;
  while (hasNextPage && pages < maxPages && Date.now() < deadline) {
    // Backpressure: a first catch-up or a webhook outage can enqueue thousands of rows
    // in one pass while the worker only drains a bounded number per invocation. Stop
    // paging further once the backlog crosses a sane watermark instead of growing it
    // without limit — the checkpoint stays exactly where the last successful page left
    // it, so the next invocation resumes cleanly once the backlog has drained.
    if ((await pendingCount(db, scope.workspace)) >= PENDING_WATERMARK)
      return { collection, complete: false, pages, enqueued, error: 'BACKPRESSURE' };
    // A repeated/stuck cursor (never advancing) would loop forever — a malformed cursor
    // must abort the pass rather than spin.
    const priorCursor = cursor;
    const { classification, page: root } = await fetchPage(
      env,
      query,
      fetcher,
      cursor,
      passSince,
      passUntil,
    );
    if (classification.kind !== 'ok')
      return { collection, complete: false, pages, enqueued, error: classification.kind };
    const page = root?.[collection];
    const malformed = validatePage(page);
    if (malformed) return { collection, complete: false, pages, enqueued, error: malformed };
    enqueued += await enqueuePage(
      db,
      scope.workspace,
      scope.sourceWorkspaceId,
      resourceType,
      collection,
      page.nodes ?? [],
    );
    hasNextPage = Boolean(page.pageInfo.hasNextPage);
    cursor = page.pageInfo.endCursor ?? cursor;
    if (hasNextPage && cursor === priorCursor)
      return { collection, complete: false, pages, enqueued, error: 'MALFORMED_CURSOR' };
    pages++;
    version = await persistCheckpoint(
      db,
      scope.workspace,
      scope.sourceWorkspaceId,
      collection,
      {
        cursor: hasNextPage ? cursor : null,
        passSince,
        passUntil,
        status: hasNextPage ? 'in_progress' : 'complete',
      },
      version,
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
  // Issues and comments each get their OWN fixed sub-deadline instead of racing against
  // one shared clock — otherwise a slow issues phase can starve comments down to zero
  // pages on every single invocation, not just occasionally. Comments' deadline is
  // anchored to the pass START (not to whenever issues happens to finish), so it always
  // gets at least half the budget regardless of how issues behaves, and MORE than half if
  // issues finishes early.
  const start = Date.now();
  const issuesDeadline = start + budgetMs / 2;
  const commentsDeadline = start + budgetMs;
  const issues = await reconcileCollection(
    db,
    env,
    scope,
    'issues',
    'Issue',
    ISSUES_QUERY,
    fetcher,
    maxPages,
    issuesDeadline,
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
    commentsDeadline,
  );
  return { configured: true, aborted: false, issues, comments };
}
