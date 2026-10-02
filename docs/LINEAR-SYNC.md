# Linear live sync (ongoing, one-way)

This is an ADDITIVE, ongoing sync of a previously-imported Linear workspace into this
application's native Issue and Comment rows. It is separate from — and reuses the ID
mappings of — the one-time Linear import feature described elsewhere. It does not replace,
rerun, or modify the import. This document describes the code as it exists after this
pass; it is not a claim that the feature is live, verified against a real Linear workspace,
or ready to deploy.

## Coverage table (what's implemented vs. still unsupported)

| Area                                                                                                                                                | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Issue create/update                                                                                                                                 | Implemented, tested.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Comment create/update                                                                                                                               | Implemented, tested.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Bounded catch-up reconciliation                                                                                                                     | Implemented, tested.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Admin status/retry/conflict-resolution                                                                                                              | Implemented, tested (version-fenced).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Issue/Comment `remove`/restore lifecycle                                                                                                            | **Core implemented, believed green, not re-verified this session after the last edit** (see the round-4 report / closure matrix below for the exact caveat). `Issue:remove`/`Comment:remove` are now supported deliveries: a verified remove sets `linear_source_map.source_deleted_at` (or a `linear_removal_receipts` row for a source id never imported), never touches native content, never calls `fetchIssue`/`fetchComment`. A later update newer than the removal is an implicit restore; older/equal is a stale no-op. A local edit diverged at removal time is recorded as a sticky `linear_sync_conflicts` row (`field='__source_removed__'`). **Not done**: the admin `'acknowledged'` resolution path for that conflict field, and exposing the marker on `tickets/service.mjs`'s read surface (`getIssue`) — both explicitly deferred past this checkpoint, see below. |
| Other Linear resource families (Projects, Documents, Initiatives, Issue labels, Cycles, Users, Teams, WorkflowStates, ProjectMilestones, relations) | **Planned, not started.** Explicitly out of scope for every dispatch so far; a webhook for any of these is recorded `unsupported`, nothing is mapped or applied.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Attachment byte migration                                                                                                                           | **Planned, not started.** Metadata-only was out of scope from the first pass; this pass does not touch attachment bytes at all.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## This round's closure matrix

Round 4, Priority 1 (5 stale-fixture/real-bug fixes + title-length bound + source-id-echo
guard): **DONE, verified green** — focused suite (`linear-sync.test.mjs` +
`linear-sync-map-merge.test.mjs` + `linear-sync-client.test.mjs`) went from 69 pass / 5 fail
to 75 pass / 0 fail, then to 77 pass / 0 fail after the two new P1 tests; full repo suite
(`tests/unit`) 260 pass / 0 fail, confirming no regressions elsewhere.

Round 4, Priority 2 (Issue/Comment remove + implicit restore lifecycle): **core implemented,
13 required tests written; last full-green run was 87/88, with the 1 failure a test-assertion
bug (not a worker.mjs bug) that has since been fixed but NOT re-verified this session** — see
the round-4 report for the exact sequence and why re-verification didn't happen (a machine
memory-pressure gate blocked `bun test` twice in this window; the project's own stop-rule for
this dispatch says retry once then stop and report, not keep retrying).

Round 4, Priority 3 (real point-query resolver, end-to-end `AbortSignal` wiring,
`recordFailure` status-check fix): **NOT ATTEMPTED** — the stop-rule for this dispatch was
explicit: do not start P3 on top of a half-finished P2, and P2 was still mid-verification when
the memory gate forced a stop.

| Item                                                                                                                     | Code location                                                                                                                                                 | Test                                                                                                                                                       | Result                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A.1: point-query/memoize `loadResolvers` (P3's stricter bar: real per-delivery point-queries)                            | not done this round                                                                                                                                           | not written this round                                                                                                                                     | **NOT ATTEMPTED** (P3, deferred by the stop-rule).                                                                                                                                                                     |
| A.2: actually wire `AbortSignal`/deadline through `hydrateEntity`/`resolveCanonicalOrganizationId`/`reconcileCollection` | not done this round                                                                                                                                           | not written this round                                                                                                                                     | **NOT ATTEMPTED** (P3, deferred by the stop-rule). The plumbing itself (`client.mjs` accepting `signal`) was done in a prior round but nothing constructs/passes a real signal yet.                                    |
| A.2: `recordFailure` fencing on `status` as well as `claim_token`                                                        | not done this round                                                                                                                                           | not written this round                                                                                                                                     | **NOT ATTEMPTED** (P3, deferred by the stop-rule).                                                                                                                                                                     |
| P2: remove skips entity hydration entirely (grep-provable: zero `fetchIssue`/`fetchComment` calls)                       | `worker.mjs`: `hydrateEntity`'s `job.action === 'remove'` branch                                                                                              | `linear-sync.test.mjs`: every P2 test uses `removeOnlyFetcher`, which throws on any non-organization GraphQL query                                         | Implemented; last seen passing (see caveat above).                                                                                                                                                                     |
| P2: source-deleted marker + unmapped-id receipt                                                                          | `worker.mjs`: `applyRemove`, `recordRemovalReceipt`; `packages/db/migrations/0008_linear_sync.sql`: `last_removed_at`/`restored_at`/`linear_removal_receipts` | `linear-sync.test.mjs`: "P2: a signed Issue:remove …", "P2: a signed Comment:remove …", "P2: a remove for a source id that was never imported/mapped …"    | Implemented; last seen passing (see caveat above).                                                                                                                                                                     |
| P2: chronology safety (stale/duplicate remove, stale update after remove, late remove after restore)                     | `worker.mjs`: `isStaleRemove`, `handleImplicitRestore`                                                                                                        | `linear-sync.test.mjs`: "P2: a duplicate remove delivery …", "P2: a stale update after a remove …", "P2: a late remove replay after an implicit restore …" | Implemented; last seen passing (see caveat above).                                                                                                                                                                     |
| P2: local-edit-vs-deletion sticky conflict, native content always retained                                               | `worker.mjs`: `applyRemove`'s `hasDiverged`/`recordConflicts` call                                                                                            | `linear-sync.test.mjs`: "P2: a local edit that diverged before a verified remove arrives …"                                                                | Implemented; last seen passing (see caveat above). **Not done**: the admin `'acknowledged'` resolution path for `field='__source_removed__'` — `service.mjs`'s `resolveLinearSyncConflict` was not touched this round. |
| P2: replace the 2 stale round-3 "unsupported" remove tests with real positive tests                                      | `tests/unit/linear-sync.test.mjs`                                                                                                                             | both replaced; net +11 tests (2 removed, 13 added)                                                                                                         | Done.                                                                                                                                                                                                                  |
| P2: activity describes the actual outcome (not a generic code)                                                           | `packages/server/modules/tickets/activity.mjs`: `describeImportedChange`'s `sourceRemoved`/`sourceRestored`/`sourceRemovalConflict` handling                  | covered indirectly by the P2 happy-path test's `activity[0].summary` assertion                                                                             | Implemented; last seen passing (see caveat above).                                                                                                                                                                     |
| P2: expose the marker on existing read surfaces (`tickets/service.mjs`'s `getIssue`, comment read path)                  | not done this round                                                                                                                                           | not written this round                                                                                                                                     | **NOT ATTEMPTED** — explicitly deferred (advisor guidance for this round: get the worker core + 13 tests green first, read-surface exposure after).                                                                    |

## Architecture

1. **Webhook inbox** (`packages/server/modules/linear-sync/webhook.mjs`, route
   `POST /api/webhooks/linear`): verifies the static-secret HMAC signature and basic
   payload shape (an object with `type`, `action`, `data.id`) FIRST, before any workspace
   lock or database query — an invalid or unsigned request never touches the database.
   Only once the request is proven authentic does it check freshness, resolve the
   configured workspace/import and validate the delivery belongs to the one Linear
   organization this workspace imported from, then persists the delivery into
   `linear_webhook_inbox` (`INSERT ... ON CONFLICT(workspace_id,delivery_id) DO NOTHING`).
   A resource type/action pair outside the supported set (`Issue`/`Comment` ×
   `create`/`update`/`remove`) is still accepted and recorded with `status='unsupported'`
   — never silently dropped. A duplicate delivery id with a different body is recorded in
   `linear_webhook_inbox_mismatches` and the original row is never overwritten. This
   function makes no network calls.
2. **Outbound Linear GraphQL client** (`client.mjs`): a thin `linearGraphQL(env, query,
variables, {fetcher})` wrapper around a fixed endpoint
   (`https://api.linear.app/graphql`), and a pure `classifyLinearError(result, options)`
   that turns an HTTP status/body into `{kind: 'retryable'|'unauthorized'|'blocked'|
'not_found'|'org_mismatch'|'ok', ...}`. Every caller injects `fetcher`; nothing here
   ever touches a real socket, including in tests. `not_found` is reserved for an
   EXPLICIT, verified removal signal only: HTTP 200, the requested entity field present
   and `null`, and NO GraphQL `errors[]` on the response. Any `errors[]` present — even
   alongside a null entity field — classifies as `unauthorized` (an auth/permission error
   code) or `blocked` (anything else: validation error, partial response, etc.), never
   `not_found`. This is deliberate: an application-level GraphQL error is not a verified
   deletion, and treating it as one would tombstone content on a permission hiccup.
3. **Worker** (`worker.mjs`, `runLinearSyncWorker(db, env, {limit, fetcher})`): a
   lease-fenced claim loop copied structurally from the existing GitHub/Slack
   `integrations.runWorker` — claim one `pending`/`processing` row in a short transaction,
   hydrate the current entity from Linear OUTSIDE any transaction, then apply the merged
   result and mark the row `done`/`blocked` in ONE final transaction. A crash between
   hydration and the final transaction leaves the row `processing`; the lease expires and a
   later worker run reclaims it. `unsupported` rows are never claimed (the claim query only
   looks at `pending`/`processing`) and are never marked `done` — they are a terminal,
   explicitly-recorded state, visible in the status endpoint's counts. A GraphQL response
   classified `blocked` (see above) throws a `blocked` `SyncSignal`, which marks the inbox
   row `blocked` WITHOUT ever tombstoning or otherwise touching the native row — this
   happens before any transaction is opened for that delivery, so a permission problem can
   never commit a partial write.
4. **Field mapping** (`map.mjs`): `mapIssue`/`mapComment` reuse the exact table/column
   names and enum values from the one-time import's bulk mapper
   (`packages/imports/linear-projection.mjs`), but map ONE hydrated record at a time and
   resolve every cross-reference through an injected `resolveRef(collection, sourceId)`
   backed by `linear_source_map`. A reference that cannot be resolved reports the whole
   entity as `blocked` — never a partial write.
5. **3-way merge** (`merge.mjs`): `mergeFields(baseline, local, remote, fields)` compares
   each tracked field against a baseline. The baseline for an import-era row (never synced
   before) is derived on the fly by re-running the frozen `linear_import_records` payload
   through the same mapper. After a successful sync, `linear_source_map.local_snapshot` is
   updated to a **remote-normalized** baseline (the mapped fields as Linear now has them),
   NOT the merge outcome — a locally-kept value during a conflict must stay protected on
   every subsequent delivery, including a repeat of the exact same remote change, until an
   admin explicitly resolves the conflict. Real native member assignment
   (`issues.assignee_id`, a `memberships` row) is never touched by the sync unless the
   Linear-side assignee (`assignee_source_id`, a `source_people` row) actually changes —
   an unrelated remote field change never clears a real assignment. A field both sides
   changed to different values is a real conflict: the local value is kept, and the
   conflict is recorded in `linear_sync_conflicts` for admin resolution — the row is not
   blocked, only that field's remote change is set aside. An unchanged remote delivery
   (identical hydrated payload hash to what's already applied) is a no-op: zero native
   writes, zero version bump, zero activity row.
6. **Claim fencing** (`worker.mjs`): a claim carries a `claim_token` set under the row
   lock at claim time; both the success path (`applyInboxRow`) and the failure path
   (`recordFailure`) re-check that token under the row lock before writing, so an expired
   worker whose lease has already been reclaimed by someone else can never overwrite a
   newer claim or silently reset a completed job. A delivery whose canonical source
   `updatedAt` is not newer than what's already applied is rejected as a no-op.
7. **Reconciliation backstop** (`reconcile.mjs`,
   `reconcileLinearWorkspace(db, env, {fetcher, budgetMs, maxPages})`): pages through
   issues/comments changed since a persisted checkpoint (`linear_sync_cursors`) and
   enqueues each as a synthetic `linear_webhook_inbox` row
   (`delivery_id = 'reconcile:<collection>:<id>:<updatedAt>'`) so it flows through the exact
   same worker apply path as a real webhook. A catch-up PASS holds a FIXED lower/upper
   `updatedAt` bound for its entire duration — that bound is set once, from the persisted
   checkpoint, at the start of the pass, and is never narrowed page-by-page. The
   `last_synced_at` watermark used as the NEXT pass's lower bound only advances once the
   CURRENT pass's final page commits; the pagination `cursor` is persisted after every page
   so a second invocation resumes correctly, but resuming never uses a stricter filter than
   the one the still-open pass started with. This fixes a data-loss bug where an
   in-progress pass that advanced its filter bound per page could silently skip
   same-timestamp rows on the next invocation. The endpoint also rejects a malformed or
   repeated pagination cursor, requires a `pageInfo` in the response, includes archived
   items, and never treats a missing `organization` field on an otherwise-200 response as a
   validated organization. Concurrent checkpoint writers are guarded by an optimistic
   version check on `linear_sync_cursors`. Note: this delivery-id scheme dedups a reconcile
   pass against ANOTHER reconcile pass for the same change; it is NOT itself what makes a
   reconcile row safe against a real webhook UUID for the same edit — that safety comes
   from the worker's own claim/generation fencing (point 6 above) and the unchanged-remote
   no-op described in point 5, which make any inbox-row overlap harmless regardless of its
   `delivery_id`.
8. **Admin surface** (`service.mjs` + routes under `/api/v1/sync/linear/*`): read-only
   status (inbox counts by status, oldest pending age, open conflict count, cursor state),
   list conflicts, resolve a conflict (`kept_local` or `applied_remote`), and retry a
   `failed`/`blocked` inbox row by resetting it to `pending`.
9. **Worker workspace/organization pinning** (`worker.mjs`): the claim query only selects
   inbox rows for the single workspace configured via `LINEAR_SYNC_WORKSPACE_ID` — it never
   iterates other workspaces' rows in the same process. Before any native write, the worker
   confirms the canonical organization id returned by a live `fetchOrganizationId` call
   matches the imported workspace's `source_workspace_id`, the `linear-sync` module is
   enabled, and the acting importer is still a current, authorized member of the
   workspace — an importer whose membership was later revoked can no longer drive writes.

## Per-resource support in this pass

| Resource                                                                                                             | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issues                                                                                                               | Supported and tested: create, update (3-way merged), numbering-collision handling on create.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Comments                                                                                                             | Supported and tested: create, update (3-way merged).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Deletions (Issue/Comment only)                                                                                       | **Implemented (see the round-4 closure matrix above for verification status).** `Issue:remove`/`Comment:remove` are supported deliveries: a verified remove sets `linear_source_map.source_deleted_at` (or a `linear_removal_receipts` row for a source id never imported/mapped) — never a hard- or soft-delete of native content. A source read that comes back absent or forbidden during an UPDATE hydration is STILL a BLOCKED delivery, never an inferred deletion — that ambiguity is exactly what the remove path exists to avoid resolving from a mere read. A later update newer than the removal is treated as an implicit restore; a stale/duplicate remove or a stale update arriving after a genuine remove is a no-op, never re-applied or resurrecting. A local edit that had diverged from baseline at removal time is recorded as a sticky conflict (`linear_sync_conflicts`, `field='__source_removed__'`) with native content always retained; **the admin resolution endpoint for that conflict field, and exposing the marker on the issue/comment read surface, are not yet done** (see closure matrix). Deletions for every OTHER resource family (Projects, Documents, Initiatives, etc.) remain out of scope, exactly as those families are out of scope for create/update too. A source issue reported as `trashed:true` on a normal `Issue:create`/`Issue:update` (Linear trash detected via an ordinary field, not a `remove` webhook) is a SEPARATE, older safety guard (`SOURCE_TRASHED_UNSUPPORTED`) — conservative blocking, not the removal lifecycle described here. |
| Projects, Documents, Initiatives, Issue labels, Cycles, Users, Attachments, Teams, WorkflowStates, ProjectMilestones | **Pending.** A webhook for any of these resource types is accepted and recorded with `status='unsupported'` in `linear_webhook_inbox` — never silently dropped — but nothing is mapped or applied. Attachment byte transfer is out of scope entirely (metadata-only was explicitly out of scope too; this pass does not touch attachments at all beyond recording an unsupported delivery). An issue that references one of these entity types before it is independently synced (e.g. a brand-new team, status, project, or Linear user created after the import) correctly falls into `blocked` per the missing-reference rule — this is an expected, self-healing state: once that dependency exists in `linear_source_map` (via a future increment or an admin retry after manual reconciliation), the same row can be retried and will apply.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Absent/forbidden source read vs. genuine application error                                                           | Handled via `classifyLinearError`: HTTP 401/403 is always `unauthorized` (→ `blocked`, never touches the local row); any `errors[]` present on an otherwise-200 response is `unauthorized` (auth-coded errors) or `blocked` (everything else) — never `not_found`, and `not_found` itself is never read as a removal signal by the worker (deletions are out of scope; see the row above). This split is implemented and unit-tested directly against constructed fixture responses, but is a **documented assumption**, not verified against a real Linear API response — see below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Known gaps / not done in this pass

- Only `issues` and `comments` are mapped/applied. All other resource families are
  recorded as `unsupported` inbox rows per the table above — this was explicit scope for
  this pass, not an oversight.
- The reconciliation backstop only paginates `issues` and `comments`; it does not poll
  teams/workflow states/users, so a referenced-but-unmapped dependency only clears once a
  future increment adds that collection's sync, or an operator manually inserts the mapping
  and retries.
- The activity feed entry for a sync-created issue or comment renders a generic "updated
  the issue in Linear" summary rather than a bespoke "created" message, because it reuses
  the existing `linear_imported_change` renderer (`describeImportedChange`) which has no
  "created" case. Attribution (actor, timestamps, `synced:true` + `delivery_id` in `data`)
  is correct; only the summary text is generic. This is a cosmetic gap, not a correctness
  one.
- `presentActivity`'s reference-name lookup for a post-import issue falls back to
  `linear_sync_records` (the live sync's hydrated-payload cache) for the `issues`
  collection only — the only collection the sync worker ever hydrates standalone. It cannot
  resolve a friendly name for a post-import team/status/label/etc. reference; those still
  render as "Unavailable X" until that collection is imported or synced in a future
  increment.

## Documented assumptions — verify during activation, not before

- **Webhook header names.** `linear-signature` (hex HMAC-SHA256 of the raw body) and
  `linear-delivery` (the delivery UUID) follow Linear's public webhook documentation
  (https://linear.app/developers/webhooks). No existing code in this repository calls a
  real Linear webhook, so these header names were **not live-verified** against an actual
  delivery. Verify them against a real Linear delivery before relying on this in
  production.
- **HTTP 400 RATELIMITED.** Per Linear's rate-limiting documentation
  (https://linear.app/developers/rate-limiting), a GraphQL `RATELIMITED` error can be
  surfaced with HTTP 400 as well as the classic HTTP 429. `classifyLinearError` treats a
  400 response carrying a GraphQL error with `extensions.code === 'RATELIMITED'` as
  retryable, exactly like 429, so a burst of rate-limiting responses schedules a retry
  instead of a crash loop or false "not found"/"blocked" classification. Not live-verified.
- **Not-found vs. unauthorized/blocked shape.** Assumed: a genuine deletion surfaces as
  HTTP 200 with a null entity field and NO `errors[]`; a permission problem surfaces as
  HTTP 401/403 or a GraphQL error with an auth-coded `extensions.code`; any other
  application-level GraphQL error is treated as `blocked` (retryable/investigatable), never
  as a deletion signal. This is inferred from Linear's general GraphQL error conventions,
  not confirmed against a real deletion or a real permission-scoped token.

## Activation blocker (out of scope for this pass to resolve)

Registering an actual webhook subscription against a live Linear workspace requires an
admin-scoped call that was blocked by a FORBIDDEN/admin-required response from the
authorized Linear CLI available in this environment — a live/production credential and
permission problem, not a code problem. The code in this pass ships fully disabled by
default: `LINEAR_SYNC_WORKSPACE_ID`, `LINEAR_WEBHOOK_SECRET`, and `LINEAR_API_TOKEN` are
all unset in `.env.example`, and every entrypoint (`receiveLinearWebhook`,
`runLinearSyncWorker`'s hydration calls, `reconcileLinearWorkspace`) asserts a 503
`LINEAR_SYNC_NOT_CONFIGURED` when they are absent, or when no completed Linear import
exists yet for the configured workspace. This is not ready to deploy or live; it is
additive, disabled-by-default code.

## Configuration

New environment variables (see `.env.example`), single-tenant like the existing
`INTEGRATIONS_WORKSPACE_ID` pattern:

- `LINEAR_SYNC_WORKSPACE_ID` — the one workspace this deployment syncs into.
- `LINEAR_WEBHOOK_SECRET` — HMAC secret for verifying inbound webhook signatures.
- `LINEAR_API_TOKEN` — server-only read-only Personal Access Token for outbound GraphQL
  reads (issue/comment hydration and the reconciliation backstop).

The Linear organization id to validate incoming webhooks against is read from the
workspace's most recent completed `linear_imports` row (`source_workspace_id`) — there is
no separate, redundant environment variable for it. The worker independently re-verifies
this against a live `fetchOrganizationId` call before any write (see architecture point 9).

## Module

Registered in `packages/server/core/modules.mjs` as `linear-sync`, depending on `tickets`,
enabled by default (matching the existing modules pattern) but inert without the three
environment variables above.

## Database migration

`packages/db/migrations/0008_linear_sync.sql` (schema version 8), purely additive:

- `linear_source_map` gains `local_snapshot`, `source_deleted_at`, `synced_at`.
- New tables: `linear_sync_records` (live hydrated payload cache, distinct from the frozen
  `linear_import_records`), `linear_webhook_inbox` (with a `claim_token` column for lease
  fencing), `linear_webhook_inbox_mismatches`, `linear_sync_conflicts`,
  `linear_sync_cursors` (with `pass_since`/`pass_until` fixed-pass bounds and a `version`
  optimistic-concurrency column).

No existing migration file was modified; this file was edited in place while the feature
was still unreleased/unapproved rather than adding a 0009 migration.

## Endpoints added

- `POST /api/webhooks/linear` — signed webhook receipt (CSRF-exempt, like the existing
  GitHub/Slack webhook routes). Responds **200**, not the 202 the GitHub/Slack webhooks
  use — Linear expects a prompt 2xx receipt, and by the time this responds the delivery is
  already durably queued. One delivery is then attempted inline, best-effort, via the same
  `defer` (waitUntil-style) hook `dispatchMail` uses, bounded by the request's own
  lifetime and never blocking the response. `/api/internal/linear-sync` (see below) and a
  manual `POST /api/v1/sync/linear/retry` remain the recovery path for anything the inline
  attempt doesn't finish or that fails.
- `GET /api/internal/linear-sync` — runs one worker batch (time-budgeted, not a hardcoded
  count — see below) and one reconciliation pass, guarded by `CRON_SECRET` exactly like the
  existing `/api/internal/account-email` and `/api/internal/jobs` routes. **There is no
  cron schedule configured for this route** — it is NOT wired into `vercel.json`'s cron
  list (the existing account-email cron entry is untouched; no new cron/minute/hour
  schedule was added, staying on the Hobby plan's constraints). Recovery beyond the inline
  per-webhook attempt above is manual/on-demand invocation of this route or the admin retry
  endpoint — there is no actual "daily backstop" running unless something external is
  configured to call it on a schedule; do not read this document as claiming one exists.
  The route uses ONE shared deadline (currently a 55s margin under Vercel's 60s function
  budget) for both the worker batch and the reconciliation pass together: the worker is
  bounded by time (not a fixed `limit`), and reconciliation receives whatever time is left
  after the worker phase — split into independent, fixed sub-budgets for issues and
  comments so a slow issues phase can never starve comments to zero pages. Reconciliation
  also stops enqueueing further pages once the pending/processing backlog crosses a sane
  watermark (500 rows), to avoid growing an already-large backlog without limit when only
  a bounded amount of work drains per invocation and no cron exists.
- `GET /api/v1/sync/linear/status` — admin-only counts/cursors/conflict summary.
- `GET /api/v1/sync/linear/conflicts` — admin-only, `?resolved=true|false`.
- `POST /api/v1/sync/linear/conflicts/{id}/resolve` — admin-only, body
  `{"resolution": "kept_local" | "applied_remote"}`.
- `POST /api/v1/sync/linear/retry` — admin-only, body `{"inbox_id": "<uuid>"}`, resets a
  `failed`/`blocked` row back to `pending`.
