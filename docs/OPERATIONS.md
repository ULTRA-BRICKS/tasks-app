# Operations — Forgejo release, 12 September 2026

## Current service

Production origin: **https://tasks-ultrabricks.vercel.app**.
Source of truth: **https://git.hyperide.ai/ultrabricks/tasks-app**.

The existing Vercel project is `tasks-app` (renamed from `tickets-app`, ID unchanged) (`prj_BicxQsqDlb394HzvMuXZKB883EdY`), under `inventorems-projects`. No second Vercel project was created. The Neon production schema and owner already exist: the public `/api/ready` endpoint returns HTTP 200 with `{"status":"ready"}`. This supersedes the earlier empty-database observation.

The former `tickets-app-sandy.vercel.app` address belongs to a different project. It is not a valid address for this release. `APP_URL` is now the canonical origin above. Do not weaken exact Origin/CSRF validation to accommodate unrelated preview URLs.

The obsolete GitHub publisher has been disconnected. Source changes are pushed to Forgejo. This release uses an explicitly authorized **manual CLI publisher** from the operator's computer; future Forgejo pushes do not automatically deploy to Vercel. `.forgejo/workflows/ci.yml` defines verification, not unattended production promotion. An available Forgejo Actions runner is required; a local passing run is not evidence that a hosted runner executed it.

Vercel Standard Protection leaves the production domain accessible and protects preview/unique deployment URLs. Application sessions and workspace authorization still protect all private data. An anonymous request to `/api/v1/me` returns 401.

## Deployment procedure

Use the existing project link and native CLI authorization. Never place credentials in the repository, its logs, PRs, or screenshots. Production migrations are explicit; builds and requests never initialize or reset a database. Sensitive Vercel variables cannot be safely reconstructed from placeholder values returned by environment exports, so never pull or re-create them for a deploy.

This sequence was run for both releases of 29 September 2026. Every step matters: skipping the Linear sync rebind (step 3) leaves the site up but silently stops synchronization.

### 1. Clean candidate tree and gates

Deploy the exact merged commit from a clean archive, never from a working checkout. Run from the main checkout after `git fetch origin`:

```sh
R=$(pwd); SHA=$(git rev-parse origin/main)
git ls-tree --name-only $SHA packages/db/migrations/ | wc -l   # must equal the schema production already runs; a new migration means stop
D=/tmp/tasks-release-$SHA; mkdir -p $D && git archive $SHA | tar -x -C $D
mkdir -p $D/.vercel && cp .vercel/project.json $D/.vercel/    # project link only; no `vercel env pull`
cd $D && bun install --frozen-lockfile && bun run check && bun run typecheck:tsc
```

The archive has no `.git`, and `check:secrets` fails closed when `git ls-files` cannot list tracked paths. Scan the archive against a temporary index built from the release tree, so the tracked-path rules see exactly `$SHA` and the checkout's real index is untouched:

```sh
cd $D
export GIT_DIR=$R/.git GIT_WORK_TREE=$D GIT_INDEX_FILE=/tmp/tasks-release-index-$SHA
git read-tree $SHA && git ls-files --cached | wc -l            # the release's tracked file count
bun run check:secrets
rm -f $GIT_INDEX_FILE; unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
```

Browser acceptance (`bun run test:e2e`) runs in a detached worktree at `$SHA`. Receipts from a merge run count only when their tested tree equals `$SHA^{tree}`.

### 2. Deploy and check the candidate

```sh
vercel deploy --prod --skip-domain --yes --scope inventorems-projects      # prints CANDIDATE_HOST
vercel inspect CANDIDATE_HOST --scope inventorems-projects                 # Ready; record NEW_DPL (dpl_…)
vercel curl /api/health --deployment CANDIDATE_HOST --scope inventorems-projects   # 200 ok
vercel curl /api/ready --deployment CANDIDATE_HOST --scope inventorems-projects    # {"status":"ready"}, otherwise stop
vercel curl /api/v1/me --deployment CANDIDATE_HOST --scope inventorems-projects -- -s -o /dev/null -w '%{http_code}\n'   # 401
vercel curl / --deployment CANDIDATE_HOST --scope inventorems-projects | grep -o 'assets/index-[^"]*\.js'   # record the asset
vercel inspect tasks-ultrabricks.vercel.app --scope inventorems-projects | grep -E '^\s+id'   # OLD_DPL: the rollback target
```

**`--skip-domain` holds back only the canonical domain.** The deploy still moves the project's default production alias `tasks-app-inventorems-projects.vercel.app` onto the candidate immediately (the deploy log prints `Aliased https://tasks-app-inventorems-projects.vercel.app`). Before promotion that alias therefore serves the unpromoted candidate. Do not use it to judge whether promotion happened, as a rollback host, or as the origin for sync calls. Only `tasks-ultrabricks.vercel.app` shows what production serves. The Linear webhook targets the canonical domain, so the moved alias does not change sync.

### 3. Promote, then rebind Linear sync

Linear sync stores exactly one deployment id as its writer (`configureSync` in `packages/server/modules/linear-live/store.mjs` records `VERCEL_DEPLOYMENT_ID`). Every other deployment gets `409 SYNC_DEPLOYMENT_CHANGED` from `readSyncConfig`, and the webhook receiver, outbox dispatch and queue consumer, daily cron, reconcile and retry all stop. **Rebind right after every promote and every rollback**, in this order:

1. Before promoting, save `GET /api/v1/sync/linear/status` as the pre-deploy receipt. The writer is still OLD_DPL. Record `configuration.organizationId`, `configuration.teamIds` and `counts`.
2. `vercel promote CANDIDATE_HOST --yes --scope inventorems-projects`
3. `vercel inspect tasks-ultrabricks.vercel.app --scope inventorems-projects`: the `id` must be NEW_DPL.
4. `POST /api/v1/sync/linear/configure` with `{"organizationId": <saved>, "enabled": true, "teamIds": <saved>}`. This is a production write. It binds whichever deployment answers the request. Pass the saved `teamIds`: if you omit them, sync scopes to every known team.
5. `GET /api/v1/sync/linear/status`: `configuration.deploymentId` must be NEW_DPL.
6. `POST /api/v1/sync/linear/reconcile` with `{}`. This is a production write that queues catch-up jobs for the gap.

Send these calls only to `https://tasks-ultrabricks.vercel.app`. Use an operator bearer token with admin permission, kept in the operator's protected configuration and never printed. Configure only after step 3 confirms the new deployment. A configure that reaches the candidate, or the moved secondary alias, while the old deployment still serves the canonical domain binds the wrong writer and stops sync. Between promote and configure, webhooks receive 409. Keep this gap short: in both 29 September runs, promote through reconcile took under 10 seconds. Reconcile and the daily `/api/internal/linear-sync` cron are the durable catch-up. For the release rules for sync itself, see [Linear live release](LINEAR-LIVE-RELEASE.md).

**Rollback** uses the same rebind. Run `vercel promote OLD_DPL --yes --scope inventorems-projects` (or `vercel rollback OLD_DPL --scope inventorems-projects`), then repeat steps 3–6 with OLD_DPL as the expected writer. If you roll back without rebinding, the restored deployment keeps receiving 409 and sync stays stopped.

### 4. Post-deploy verification

Run against `https://tasks-ultrabricks.vercel.app` and keep the receipts outside the repository:

1. `/api/health` returns 200 `{"status":"ok",…}`. `/api/ready` returns 200 `{"status":"ready"}`.
2. Anonymous `/api/v1/me` and `/api/v1/sync/linear/status` return 401.
3. Canonical `index.html` references the candidate asset recorded in step 2, and that asset returns 200. `index.html` is edge-cached (`x-vercel-cache: HIT`) and promotion purges it, so a stale asset means stop and investigate. The secondary alias serves the same asset.
4. Sync status names NEW_DPL as the writer. Compared with the pre-deploy receipt, `done` grows, and any new problems belong to error classes that already existed. A new class needs investigation before the release counts as accepted.
5. Logs (`vercel logs -p tasks-app --scope inventorems-projects --environment production --since 15m --json`):
   - `--query /api/webhooks/linear` returns 200 on NEW_DPL.
   - `--query linear-consumer` returns 200 on NEW_DPL.
   - `--status-code 409`, `--status-code 500` and `--level error` return no rows.
6. `/` and `/login` render with no page errors at 390×844, 320 wide and 1440×900 (Chromium). Read the screenshots back.
7. The authenticated round-trip below, plus one disposable Linear task/comment in each direction, need the owner's explicit approval. `/api/ready` does not substitute for them.

## Verification boundary

Local Chromium/WebKit tests perform real browser sign-in, creation, editing, reload, conflict resolution, and gesture interactions against an isolated synthetic test server. PostgreSQL acceptance uses a separate Neon test endpoint, never the production database. Blob SDK unit tests verify private access, immutable keys, and exact-content retry behavior.

Production in this session was checked for application availability, schema/owner readiness, anonymous access denial, and deployment state. **An authenticated production browser round-trip and a live private Blob transfer remain unverified**: automation using the saved owner password was blocked by the tool's safety checks. Do not present `/api/ready` or the isolated tests as proof of those two checks. The existing owner credential remains in the operator's protected `~/.config/tickets-app/production-owner.json`; it must not be committed or displayed in public evidence.

Before treating the deployment as fully accepted, sign in at the canonical origin, create a clearly marked temporary issue, edit and reload it, upload/download an attachment, check anonymous download denial, and remove only that temporary issue/file.

## Storage and capacity

`STORAGE_DRIVER=blob` uses private Vercel Blob. Local disk is rejected in production. Uploads are capped at 3 MiB, validated against their declared type, reserved before upload, and quota-checked. The API authorizes downloads before storage access; it never exposes public object URLs.

At this bounded file size downloads currently buffer content. Uploads still hold a workspace write transaction while the private storage PUT completes. These are documented throughput limitations, not claims of unlimited upload concurrency. Moving upload I/O outside a transaction requires a durable claim/finalize protocol and should not be done as an untested last-minute refactor.

External Slack/GitHub provider round-trips require separately configured provider credentials. Their mock-transport acceptance tests do not imply a live integration is connected. Forgejo is the code host, not a newly implemented ticket-import provider.

The function deadline is 60 seconds and pool acquisition remains capped at 30 seconds. Reducing acquisition to 10 seconds reproduced a concurrent-create failure over the real Neon connection; the release preserves the working burst behavior while reserving half the function budget for execution.

**Saturation limit:** the 30-second acquisition cap is per transaction, not a route-wide deadline or latency guarantee. Routes such as login use multiple transactions and can still exhaust the 60-second function deadline under sustained pool saturation. The last review identified this as a remaining bounded operational limitation; no route-wide budget propagation is claimed. The final review found no remaining architecture/path/hash inconsistencies or introduced performance regressions.

## Slack notifications installation and recovery

Use `plugins/tasks/slack-app-manifest.json` to create a notifications-only Slack app, or apply its minimal notification capability to the existing Tasks app instead of creating a conflicting app. The public manifest requests only bot `chat:write`: no user, history, DM, or profile-reading scopes. Absent `_metadata` uses Slack manifest v1. The manifest is an installation recipe, not an installation receipt. See [Slack manifest reference](https://docs.slack.dev/reference/app-manifest/) and [Slack app manifests](https://docs.slack.dev/app-manifests/).

Install with authorized workspace consent and invite the bot into the intended channel. Set `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID` and the existing `INTEGRATIONS_WORKSPACE_ID` through the provider dashboard's secret configuration. Never send secret values in chat or export them to env files. Preserve existing profile maps and settings. An administrator explicitly saves Slack settings with `notify:true`; this records a channel activation watermark and generation. Enabling a module alone does not activate notifications. Disabling notifications or the module clears activation; changing the configured channel requires saving the settings again. Historical outbox events are suppressed rather than replayed; disable/re-enable starts a new generation even when timestamps tie. The notifications-only manifest does not provision slash commands or profile sync; those independent capabilities retain their existing configuration.

Successful REST, GraphQL and MCP HTTP mutations wake the `tasks-slack-notifications` queue after commit. `api/slack-consumer.mjs` drains the durable outbox with database leases and per-channel pacing. `/api/internal/slack-notifications` is a CRON_SECRET-protected daily recovery drain; the account-email and Linear schedules remain unchanged. Recovery drains up to 20 notifications with one-second pacing, then publishes a delayed continuation for the next job. Each queue callback targets its own job and continues the chain. If continuation publication fails after a successful Slack receipt, callback redelivery republishes the continuation without resending that completed message. Queue publication failure leaves durable jobs recoverable for a later wake or scheduled recovery. The manual jobs endpoint and worker remain available. Preview deployments do not publish. HTTP 429 pauses delivery for the full Retry-After floor, including waits beyond one hour, without consuming attempts. Queue wakeups recheck persisted due times before any provider request. Valid Slack channel/timestamp receipts are stored with jobs; ambiguous transport timeouts remain at-least-once delivery and require reconciliation, not an exactly-once claim.

This implementation does not install an app, configure production secrets, activate an account, apply production migrations, deploy, promote or rebind Linear. Those require the existing authorized operator/account boundary.

The integrations API reports notification `armed` (an explicit activation exists), `ready` (matching workspace/channel, enabled module, notify on, bot credential configured and production environment), and `delivery_verified` (a valid receipt from the current activation and destination). Compatibility `active` requires both readiness and that receipt. None of these proves present account connectivity; a channel setting or manifest alone is not an installed bot or a live-message receipt. Old deployment callbacks and publishers cannot claim or publish a different destination's jobs. Team links use the real `/tasks?team_id=...` filter route; task/comment links use `/tasks/<id>` without fabricated comment anchors.

Queue wake delivery is deployment-specific; see [Vercel Queues](https://vercel.com/docs/queues). Slack guards use explicit job identity, workspace and destination rather than changing the independent Linear writer binding. Existing cron schedules, OAuth permissions and Slack person maps are preserved.
