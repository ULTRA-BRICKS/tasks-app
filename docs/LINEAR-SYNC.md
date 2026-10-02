# Linear live sync (ongoing, one-way)

This is an ADDITIVE, ongoing sync of a previously-imported Linear workspace into this
application's native Issue and Comment rows. It is separate from — and reuses the ID
mappings of — the one-time Linear import feature described elsewhere. It does not replace,
rerun, or modify the import. This document describes the code as it exists after this
pass; it is not a claim that the feature is live, verified against a real Linear workspace,
or ready to deploy.

## Architecture

1. **Webhook inbox** (`packages/server/modules/linear-sync/webhook.mjs`, route
   `POST /api/webhooks/linear`): verifies an HMAC signature and a freshness window over the
   exact raw request bytes, validates the delivery belongs to the one Linear organization
   this workspace imported from, and persists the delivery into `linear_webhook_inbox`
   (`INSERT ... ON CONFLICT(workspace_id,delivery_id) DO NOTHING`). A resource
   type/action pair outside the supported set (`Issue`/`Comment` × `create`/`update`/`remove`)
   is still accepted and recorded with `status='unsupported'` — never silently dropped. A
   duplicate delivery id with a different body is recorded in
   `linear_webhook_inbox_mismatches` and the original row is never overwritten. This
   function makes no network calls.
2. **Outbound Linear GraphQL client** (`client.mjs`): a thin `linearGraphQL(env, query,
   variables, {fetcher})` wrapper around a fixed endpoint
   (`https://api.linear.app/graphql`), and a pure `classifyLinearError(result, options)`
   that turns an HTTP status/body into `{kind: 'retryable'|'unauthorized'|'not_found'|
   'org_mismatch'|'ok', ...}`. Every caller injects `fetcher`; nothing here ever touches a
   real socket, including in tests.
3. **Worker** (`worker.mjs`, `runLinearSyncWorker(db, env, {limit, fetcher})`): a
   lease-fenced claim loop copied structurally from the existing GitHub/Slack
   `integrations.runWorker` — claim one `pending`/`processing` row in a short transaction,
   hydrate the current entity from Linear OUTSIDE any transaction, then apply the merged
   result and mark the row `done`/`blocked` in ONE final transaction. A crash between
   hydration and the final transaction leaves the row `processing`; the lease expires and a
   later worker run reclaims it. `unsupported` rows are never claimed (the claim query only
   looks at `pending`/`processing`) and are never marked `done` — they are a terminal,
   explicitly-recorded state, visible in the status endpoint's counts.
4. **Field mapping** (`map.mjs`): `mapIssue`/`mapComment` reuse the exact table/column
   names and enum values from the one-time import's bulk mapper
   (`packages/imports/linear-projection.mjs`), but map ONE hydrated record at a time and
   resolve every cross-reference through an injected `resolveRef(collection, sourceId)`
   backed by `linear_source_map`. A reference that cannot be resolved reports the whole
   entity as `blocked` — never a partial write.
5. **3-way merge** (`merge.mjs`): `mergeFields(baseline, local, remote, fields)` compares
   each tracked field against a baseline. The baseline for an import-era row (never synced
   before) is derived on the fly by re-running the frozen `linear_import_records` payload
   through the same mapper; after a successful sync it is replaced by the fields that were
   just written (`linear_source_map.local_snapshot`), so the next merge compares against the
   last reconciled state, not the original import. A field that only one side changed since
   the baseline applies cleanly. A field both sides changed to different values is a real
   conflict: the local value is kept, and the conflict is recorded in
   `linear_sync_conflicts` for admin resolution — the row is not blocked, only that field's
   remote change is set aside.
6. **Reconciliation backstop** (`reconcile.mjs`,
   `reconcileLinearWorkspace(db, env, {fetcher, budgetMs, maxPages})`): pages through
   issues/comments changed since a persisted cursor (`linear_sync_cursors`) and enqueues
   each as a synthetic `linear_webhook_inbox` row
   (`delivery_id = 'reconcile:<collection>:<id>:<updatedAt>'`) so it flows through the exact
   same worker apply path as a real webhook. The cursor is only persisted after its page's
   transaction commits, so a second invocation resumes from the last completed page instead
   of restarting. Note: this delivery-id scheme dedups a reconcile pass against ANOTHER
   reconcile pass for the same change; it does not by itself dedup a reconcile row against a
   real webhook for the same edit — that dedup instead happens naturally inside the worker,
   because it compares the mapped remote fields against the current baseline and applies a
   no-op merge if nothing actually changed.
7. **Admin surface** (`service.mjs` + routes under `/api/v1/sync/linear/*`): read-only
   status (inbox counts by status, oldest pending age, open conflict count, cursor state),
   list conflicts, resolve a conflict (`kept_local` or `applied_remote`), and retry a
   `failed`/`blocked` inbox row by resetting it to `pending`.

## Per-resource support in this pass

| Resource | Status |
| --- | --- |
| Issues | Supported and tested: create, update (3-way merged), source-side deletion (tombstoned via `deleted_at`, content preserved), numbering-collision handling on create. |
| Comments | Supported and tested: create, update (3-way merged), source-side deletion (tombstoned via `linear_source_map.source_deleted_at` only — the `comments` table has no `deleted_at` column, so the body is left untouched rather than adding a column to a table shared with the rest of the app). |
| Projects, Documents, Initiatives, Issue labels, Cycles, Users, Attachments, Teams, WorkflowStates, ProjectMilestones | **Pending.** A webhook for any of these resource types is accepted and recorded with `status='unsupported'` in `linear_webhook_inbox` — never silently dropped — but nothing is mapped or applied. Attachment byte transfer is out of scope entirely (metadata-only was explicitly out of scope too; this pass does not touch attachments at all beyond recording an unsupported delivery). An issue that references one of these entity types before it is independently synced (e.g. a brand-new team, status, project, or Linear user created after the import) correctly falls into `blocked` per the missing-reference rule — this is an expected, self-healing state: once that dependency exists in `linear_source_map` (via a future increment or an admin retry after manual reconciliation), the same row can be retried and will apply. |
| Deletion vs. permission-error disambiguation | Handled via `classifyLinearError`: HTTP 401/403 is always `unauthorized` (→ `blocked`, never touches the local row), and a null single-entity query result or a generic `errors[]` on HTTP 200 is `not_found` (→ tombstone). This split is implemented and unit-tested directly against constructed fixture responses, but is a **documented assumption**, not verified against a real Linear API response — see below. |

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
- **Not-found vs. unauthorized shape.** Assumed: a genuine deletion surfaces as HTTP 200
  with either a null entity field or a generic `errors[]` array; a permission problem
  surfaces as HTTP 401/403. This is inferred from Linear's general GraphQL error
  conventions, not confirmed against a real deletion or a real permission-scoped token.

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
no separate, redundant environment variable for it.

## Module

Registered in `packages/server/core/modules.mjs` as `linear-sync`, depending on `tickets`,
enabled by default (matching the existing modules pattern) but inert without the three
environment variables above.

## Database migration

`packages/db/migrations/0008_linear_sync.sql` (schema version 8), purely additive:

- `linear_source_map` gains `local_snapshot`, `source_deleted_at`, `synced_at`.
- New tables: `linear_sync_records` (live hydrated payload cache, distinct from the frozen
  `linear_import_records`), `linear_webhook_inbox`, `linear_webhook_inbox_mismatches`,
  `linear_sync_conflicts`, `linear_sync_cursors`.

No existing migration file was modified.

## Test/lint/typecheck results (commands used)

Run from the worktree root:

- `bun test tests/unit` — before this pass: 183 pass, 0 fail. After this pass: **219 pass,
  0 fail** (36 new tests added across `tests/unit/linear-sync-client.test.mjs`,
  `tests/unit/linear-sync-map-merge.test.mjs`, and `tests/unit/linear-sync.test.mjs`; one
  pre-existing test's hardcoded schema-version literal in
  `tests/unit/regressions.test.mjs` was bumped from 7 to 8, which is the expected,
  unavoidable consequence of adding migration 0008 — no other existing test assertion was
  changed).
- `bun run lint` — clean (oxlint + FSD import-boundary check).
- `bun run typecheck` (`oxlint --type-aware --type-check --deny-warnings`) — clean.
- `bun run api:check` — clean; `scripts/openapi.mjs` and `packages/contracts/schemas.mjs`
  were extended with the six new routes/schemas and `docs/openapi.json` /
  `packages/contracts/request-types.ts` were regenerated via `bun run api:generate`.
- `bun run format` — applied to every new/changed file in this pass.

## Endpoints added

- `POST /api/webhooks/linear` — signed webhook receipt (CSRF-exempt, like the existing
  GitHub/Slack webhook routes).
- `GET /api/internal/linear-sync` — runs one worker batch (`limit: 10`) and one
  reconciliation pass (`budgetMs: 40000`), guarded by `CRON_SECRET` exactly like the
  existing `/api/internal/account-email` and `/api/internal/jobs` routes. Not wired into
  `vercel.json`'s cron list in this pass (adding a cron entry was optional per scope; the
  route is manually invokable and documented here instead).
- `GET /api/v1/sync/linear/status` — admin-only counts/cursors/conflict summary.
- `GET /api/v1/sync/linear/conflicts` — admin-only, `?resolved=true|false`.
- `POST /api/v1/sync/linear/conflicts/{id}/resolve` — admin-only, body
  `{"resolution": "kept_local" | "applied_remote"}`.
- `POST /api/v1/sync/linear/retry` — admin-only, body `{"inbox_id": "<uuid>"}`, resets a
  `failed`/`blocked` row back to `pending`.
