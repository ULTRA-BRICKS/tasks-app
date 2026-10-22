# Tasks self-hosted migration — HYP-1482

## Goal and fixed boundaries

Move application compute and PostgreSQL to bread under the user-requested k3s cluster. Infrastructure is declared in hyperide/glide-infra; application source stays in ultrabricks/tasks-app. The source database, original credentials, private attachments and complete audit/mapping state must be preserved. Existing URLs and signed migration notices must continue to work. A new public origin is not activated before authenticated compatibility is verified.

Current source: merged088787b, schema9. Neon refuses the standard verified-TLS pg_dump because its quota is exhausted. The source has not been reset; there is no usable full export yet. The cluster can be prepared independently, but no empty or reconstructed database may replace production.

## Implementation plan

1. Add an explicit TASKS_DEPLOYMENT_ID for a self-hosted writer; keep Vercel's existing default and enforce the same single-writer fence. Reject conflicting identity configuration.
2. Add LINEAR_QUEUE_DRIVER=postgres: the HTTP path leaves durable rows for the poller instead of publishing Vercel broker messages. A bounded worker reuses processLinearMessage and existing leases/backoff; no second reconciliation implementation.
3. Add a production server entrypoint that wraps existing REST, Linear GraphQL and MCP transports and serves only the built public dist directory. Validate production config, preserve exact-origin/CSRF checks, expose readiness without bootstrapping or seeding, and drain requests on shutdown.
4. Add container and Kubernetes manifests: immutable image, non-root services, persistent PostgreSQL17, protected secrets, explicit resource limits and a separate worker. Restore is an explicit operator step. A synthetic isolated deployment verifies the runtime before importing any real data.
5. Restore the full export; compare schema/table/identity counts and private objects. Transfer the single writer, preserve old URLs, perform live browser/API/files plus two-way sync checks, catch up the outage gap. Backfill remaining notices from verified receipts and resolve residual conflicts without fabricating success.

## Tests and release gates

Write failing regressions for deployment identity, PostgreSQL queue mode, inactive-writer behavior, durable retry, API/static routing, unknown assets, traversal and graceful shutdown. Run current unit/type/build checks, isolated PostgreSQL and browser/API proof. Review source before merge, deploy an immutable merged image and verify actual service state. Cluster or container readiness alone does not prove a completed data migration.

## Rollback and secrets

Before cutover the old database remains authoritative and the candidate worker stays inactive. After writes move, rollback requires fencing both sides and reconciling new writes; pointing at an older database is not a rollback. Keep original AUTH_SECRET stable because pending mail is encrypted with it. Use sops/operator-managed secret files; no credentials in source, image layers, command lines or public logs. Existing Blob storage may be retained temporarily until object copying is verified.

## Fallback: restore from Linear (Neon dump unavailable)

Isolated, read-only toward Linear; never run against production. Steps (secrets only via `keychain exec`):

1. `LINEAR_API_KEY=… bun scripts/export-linear-snapshot.mjs --out EMPTY_DIR` writes the `tickets-linear-snapshot-v1` snapshot (GraphQL queries only; a second issue pass proves no drift). Records of a team Linear no longer lists, and people missing from the user list (guests), are handled explicitly and recorded in `manifest.exclusions`.
2. `LINEAR_API_KEY=… bun scripts/download-linear-files.mjs --snapshot DIR` downloads and hashes private `uploads.linear.app` files; 404 sources stay explicit failures.
3. On an empty local PostgreSQL: `bun scripts/db.mjs migrate`, `bun scripts/db.mjs bootstrap` (new owner account), then `TEST_DATABASE_URL=postgres://…@127.0.0.1:PORT/DB bun scripts/restore-linear-snapshot.mjs --snapshot DIR --workspace-slug SLUG --report FILE --objects DIR` (loopback only; plan/apply with replay check; originals above the 3 MiB HTTP ceiling are kept).

Same-name labels of different Linear teams bind to one native label. Not recoverable from Linear: accounts, password hashes, sessions, OAuth/MCP tokens, native UUIDs (new ones are derived deterministically from the Linear ids), native-only local edits/history not mirrored to Linear, notice/queue state and the original `AUTH_SECRET`-encrypted mail.
