# Linear migration release candidate — 17 September 2026

This increment adds the functionality required before importing, not a claim that production already contains the source workspace. Account recovery and the corrected auth layout remain intact.

## Implemented and verified

Authenticated, workspace-scoped import staging, deterministic preview, explicit apply, source provenance, protected file upload/readback and replay protection share the native domain services. Source identities remain attribution records, never newly granted login memberships. Documents and initiatives have page-first UI, inline saves, conflict/draft recovery, archive/restore and linked projects. Both REST and the supported Linear GraphQL fields preserve source attribution.

The reviewed fixes include discoverable archived objects, correct private attachment links, explicit rejection of ambiguous label mappings, guarded GraphQL email nullability, and retry of an ambiguous create after reload with the original idempotency key/body. Import projection uses its own lock; the workspace write lock is taken only for final validation/insertion. A dispatch-order regression verifies the actual HTTP path.

The large-document test edits a113k Markdown body and restores it after reload in both browser engines. An earlier malformed temporary diagnostic never launched its browser; it was not evidence of an application hang. Immediate durable draft writes are intentional; the measurements do not certify every device or infinite storage.

## Current source snapshot

A new read-only export was produced without modifying or replacing the earlier snapshot. It contains1703issues,1321comments,5263history events,12projects,7milestones,4documents,1initiative,748relations and1037attachment/link metadata entries. All collection counts, IDs, checksums and checked references validated; the second issue ID/updatedAt pass found no drift during export.

194private source URLs were checked:167files downloaded and hashed (21,462,571bytes),27source404references preserved explicitly. Missing files are not represented as downloaded, and live apply requires an explicit acceptance flag. Their original references and source records remain available. Actual production Blob transfer is a separate acceptance step.

## Test and review evidence

Current application code passed176unit tests, type/generator/build checks,124Chromium/WebKit cases,18Storybook checks and secret-pattern scanning. The full refreshed snapshot passed the HTTP handler path on an isolated memory database, including byte roundtrips and identical replay. Original PostgreSQL rehearsal remains available separately. Ten focused Postgres cases completed across the full run and one corrected count-type assertion rerun; pooled setup failed before any test and was replaced by the verified direct endpoint of the same temporary test branch.

Two full external review passes and a final delta pass completed. The last security, correctness and performance reviewers reported no findings; prior findings have explicit failing-before/passing-after regressions. This does not claim global90%Linear visual parity, live email delivery or completion of the separate all-input recovery branch.

## Production boundary

Schema5–7 was prepared and tested on a temporary Neon branch. It adds attribution/import/knowledge/file records and nullable source references without changing existing users or membership rights. The production-completion tool requires explicit operator confirmation. No production schema/data change, password reset or email was executed by preparing it.

After confirmation: apply the prepared migration, publish clean reviewed source, transfer/read back private Blob objects, approve the exact refreshed import plan, apply and reconcile counts/relationships/content through live authenticated endpoints. Never publish a completed-import claim based solely on a test branch or export file.

## Refreshed PostgreSQL rehearsal completed

The September17 snapshot was applied on the prepared temporary branch (not production):1703issues,1321comments,12projects,7milestones,4documents,1initiative,748relations,5263history events. All167available private files were written/read back through the private LOCAL rehearsal adapter;27upstream404references remain explicit, pending0. Replay returned the identical result. Native application counts did not double. Accounts/memberships remain1/1.

Independent read-only SQL reconciliation on that branch found0differences in issue title/body/createdAt/updatedAt,0in comment body/dates,0in full document bodies. Receipt: the private snapshot's postgres-rehearsal.json; process36233 exited0. These results do not prove a production Blob upload or a completed live import.
