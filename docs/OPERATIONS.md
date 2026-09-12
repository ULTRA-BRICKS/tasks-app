# Operations — Forgejo release, 12 September 2026

## Current service

Production origin: **https://tickets-ultrabricks.vercel.app**.
Source of truth: **https://git.hyperide.ai/ultrabricks/tickets-app**.

The existing Vercel project is `tickets-app` (`prj_BicxQsqDlb394HzvMuXZKB883EdY`), under `inventorems-projects`. No second Vercel project was created. The Neon production schema and owner already exist: the public `/api/ready` endpoint returns HTTP 200 with `{"status":"ready"}`. This supersedes the earlier empty-database observation.

The former `tickets-app-sandy.vercel.app` address belongs to a different project. It is not a valid address for this release. `APP_URL` is now the canonical origin above. Do not weaken exact Origin/CSRF validation to accommodate unrelated preview URLs.

The obsolete GitHub publisher has been disconnected. Source changes are pushed to Forgejo. This release uses an explicitly authorized **manual CLI publisher** from the operator's computer; future Forgejo pushes do not automatically deploy to Vercel. `.forgejo/workflows/ci.yml` defines verification, not unattended production promotion. An available Forgejo Actions runner is required; a local passing run is not evidence that a hosted runner executed it.

Vercel Standard Protection leaves the production domain accessible and protects preview/unique deployment URLs. Application sessions and workspace authorization still protect all private data. An anonymous request to `/api/v1/me` returns 401.

## Deployment procedure

Use the existing project link and native CLI authorization. Never place credentials in the repository, its logs, PRs, or screenshots.

```sh
bun install --frozen-lockfile
bun run check
bun run typecheck:tsc
bun run check:secrets
bun run test:e2e
vercel deploy --prod --skip-domain --yes --scope inventorems-projects
vercel curl /api/ready --deployment CANDIDATE_HOST --scope inventorems-projects
vercel promote CANDIDATE_HOST --yes --scope inventorems-projects
```

Production migrations are explicit; builds and requests never initialize or reset a database. Recheck `/api/ready` and the canonical origin after promotion. Sensitive Vercel variables cannot be safely reconstructed from placeholder values returned by environment exports.

## Verification boundary

Local Chromium/WebKit tests perform real browser sign-in, creation, editing, reload, conflict resolution, and gesture interactions against an isolated synthetic test server. PostgreSQL acceptance uses a separate Neon test endpoint, never the production database. Blob SDK unit tests verify private access, immutable keys, and exact-content retry behavior.

Production in this session was checked for application availability, schema/owner readiness, anonymous access denial, and deployment state. **An authenticated production browser round-trip and a live private Blob transfer remain unverified**: automation using the saved owner password was blocked by the tool's safety checks. Do not present `/api/ready` or the isolated tests as proof of those two checks. The existing owner credential remains in the operator's protected `~/.config/tickets-app/production-owner.json`; it must not be committed or displayed in public evidence.

Before treating the deployment as fully accepted, sign in at the canonical origin, create a clearly marked temporary issue, edit and reload it, upload/download an attachment, check anonymous download denial, and remove only that temporary issue/file.

## Storage and capacity

`STORAGE_DRIVER=blob` uses private Vercel Blob. Local disk is rejected in production. Uploads are capped at 3 MiB, validated against their declared type, reserved before upload, and quota-checked. The API authorizes downloads before storage access; it never exposes public object URLs.

At this bounded file size downloads currently buffer content. Uploads still hold a workspace write transaction while the private storage PUT completes. These are documented throughput limitations, not claims of unlimited upload concurrency. Moving upload I/O outside a transaction requires a durable claim/finalize protocol and should not be done as an untested last-minute refactor.

External Slack/GitHub provider round-trips require separately configured provider credentials. Their mock-transport acceptance tests do not imply a live integration is connected. Forgejo is the code host, not a newly implemented ticket-import provider.
