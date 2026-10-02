# Linear event reception, separate from task application

The current user request is to finish numbering and enable synchronization. The existing complete two-way worker is still unreviewed and has known failing domain cases. This bounded release enables only durable, signature-verified event reception, so future Linear events need not be lost while that worker is completed. It MUST NOT be described as automatic task synchronization.

`POST /api/webhooks/linear` validates raw-body HMAC and the signed send timestamp before database checkout. Stream allocation is bounded to one megabyte. Workspace, source organization and webhook UUID are pinned by server configuration, and a completed import into that workspace must already exist. Unknown data-change entity types are also retained. Duplicate delivery IDs with the same event are idempotent; a fresh retry send timestamp is not part of business identity, but changed source data with the same delivery ID is rejected. Original event payloads remain private and immutable.

Accepted events are stored in the existing `webhook_deliveries` table with status `captured`. They never enter the legacy GitHub/Slack worker's pending states and do not create/apply native tasks, comments, tombstones, memberships or source writes. No migration and no source API credential are required by capture. The future applicator must explicitly consume captured rows; this release does not silently mark them synchronized.

Administrator-only `GET /api/v1/sync/linear/status` exposes counts and recent receipt metadata, never payload bodies or secret values. It explicitly reports `mode: capture-only` and `automaticApplicationEnabled: false`.

Required production server settings: `LINEAR_SYNC_WORKSPACE_ID`, `LINEAR_WEBHOOK_ORGANIZATION_ID`, `LINEAR_WEBHOOK_ID`, `LINEAR_WEBHOOK_SECRET`. The signing secret is service-owned, generated specifically for the already-created webhook. It is NOT the user's native Linear CLI token. Prior denied extraction/transfer of the user's source API token is outside this release; no such token is read or moved.

Rollout order: test/review normal commit and merge; install receiver-only settings through authorized tooling without printing secrets; deploy a clean merged candidate; verify actual readiness and signed receipt, then enable the exact existing webhook and confirm a real source delivery. Keep the old canonical deployment if any runtime check fails. Do not enable application simply because reception works.

Acceptance: signed remove retained without content changes, duplicate/mismatched replay, organization/webhook isolation, unknown models retained, admin-only non-secret status, failed signature with zero transaction calls, oversized streamed body cancelled and no legacy-worker consumption. Actual deployment and source delivery evidence belong in WORK-CHECKPOINT.md.
