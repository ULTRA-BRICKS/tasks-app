# Managed Linear synchronization — release candidate

This candidate layers the managed runtime on the published canonical-numbering release. Tasks remains the operational API and CLI backend; Linear supplies final issue numbers. This document is not proof of production activation.

## Execution and protection

Signed Linear requests are validated from bounded raw bytes before a database transaction. The immutable inbox and native-change outbox are persisted before acknowledgement. Vercel Queue messages contain job IDs and configuration generations, not private issue bodies or credentials. A per-entity lease and transactional fences protect concurrent delivery, source-write intents and final local application. Failures retain retry/blocked state and the daily authenticated reconciliation schedules missing work.

The source organization and configuring administrator are checked. Selected team scope is checked before direct source application, dependency hydration and new native issue/comment export. Unknown/missing required ownership is not interpreted as globally accessible data. Source 401/403/404 is never a removal proof. Verified source removals preserve native content and expose lifecycle/conflict metadata; no account or membership is created from source people.

Existing changes are compared against their original or last-converged per-field baselines. Incompatible edits remain inspectable conflicts, not a last-write-wins overwrite. Existing identity mappings and canonical codes are preserved. New native issues have provisional PENDING identities until the source allocator returns an actual code.

## Actual current coverage and boundaries

Source scans/hydration cover issues, comments, teams, states, labels, people, projects, milestones, cycles, documents, initiatives, relationships, attachment metadata and project/initiative updates. New native issue and owner-authored comment exports exist. Other native entity creation and several outbound metadata/archival fields still require additional implementation; unknown fields are blocked explicitly. New private attachment bytes are not automatically declared transferred merely because metadata exists. A configuring owner cannot impersonate another comment author.

These remaining capability boundaries must be resolved or stated precisely in activation/acceptance reports. Passing source tests is not proof of a complete live two-way product.

## Required deployment configuration

Production variables: `LINEAR_SYNC_WORKSPACE_ID`, `LINEAR_API_TOKEN`, `LINEAR_WEBHOOK_SECRET`, and `LINEAR_WEBHOOK_ID`. Existing database/auth/storage/email settings stay unchanged. The source token must belong to the selected source organization. Configuration is owner/admin-only and pins one deployment generation; stale deployments cannot become additional writers. The webhook remains disabled until receiver deployment, valid secret configuration and real delivery/application verification.
