# HYP-1482 — recover normalized source creations

User request: complete the recently missed Linear/Tasks synchronization without duplicate tasks or another numbering reset. Tasks remains the task-cli backend; migration notices and code-based links remain required follow-up scope.

## Observed cause, 29–30 September 2026

The live Tasks snapshot contains 13 PENDING task rows. Twelve already exist in Linear under the same UUIDs, with persisted source-creation intents. All twelve descriptions differ from the submitted text because Linear rewrites Markdown (autolinks and blockquote structure). A strict content-equivalence check after successful creation or readback refused to register the mapping and assign the returned code. One remaining UUID was absent from a scoped source lookup and had a rejected create job; investigate its request separately.

## Bounded correction

Recover a source record from the persisted create intent tied to the native UUID. Records without that proof still require matching content. Keep the original authored native body and distinct source/native baselines; an unchanged provider representation must not create an echo. Existing lease, workspace, source-organization, target UUID and optimistic-write checks remain in force. Comment parent checks remain in force.

The normalization draft already existed in another isolated worktree, tasks-pending-keys-20260930. Its owner files were not edited or committed here. A read-only snapshot was applied to a new main-based worktree (842a750) so unrelated UI work and the old attribution draft remain untouched. Identical changes must not be independently reimplemented or deployed on a stale branch.

## Evidence

On current main, the exact successful-create and lost-response recovery regressions both failed; the unrelated same-UUID record rejection passed. With the correction, all 12 targeted tests passed (178 assertions), including comment/document recovery and no duplicate create.

Red: /private/tmp/tasks-create-proof-red.log
Green: /private/tmp/tasks-create-proof-green.log
Live read-only snapshots: ~/.local/share/tickets-migrations/missing-tasks-20260930

Full gates, external review, real PostgreSQL and production recovery are separate remaining checks; no completion is inferred from this document. Retry only identified terminal jobs through the authenticated API, after deployment. Re-read source UUIDs first and verify native codes/mappings and preserved bodies afterwards. Do not recreate records that already exist, alter history, renumber unrelated tasks, or disable the running integration.
